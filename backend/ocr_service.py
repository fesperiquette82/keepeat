from __future__ import annotations

import base64
import json
import os
import re
from datetime import date, timedelta
from typing import Any

import httpx
from fastapi import HTTPException, Request

from app_core import logger, utc_now


class OcrApiError(RuntimeError):
    """Levée quand l'appel Gemini échoue.

    http_status indique le code HTTP à retourner au client :
    - 502 : erreur provider (réponse non-200, modèle introuvable, parse invalide)
    - 504 : timeout provider
    - 429 : quota / rate-limit provider
    """

    def __init__(self, message: str, http_status: int = 502):
        super().__init__(message)
        self.http_status = http_status


SHELF_BY_CATEGORY: dict[str, dict[str, int | None]] = {
    "frais":     {"fridge": 7,    "pantry": None, "freezer": None},
    "proteines": {"fridge": 3,    "pantry": None, "freezer": 90},
    "legumes":   {"fridge": 5,    "pantry": None, "freezer": 365},
    "feculents": {"fridge": None, "pantry": 365,  "freezer": None},
    "desserts":  {"fridge": 5,    "pantry": 180,  "freezer": 90},
    "boissons":  {"fridge": 7,    "pantry": 365,  "freezer": None},
    "epicerie":  {"fridge": None, "pantry": 365,  "freezer": None},
    "autres":    {"fridge": None, "pantry": 365,  "freezer": None},
}

# Prompt v2 : demande raw_title + purchase_date pour knowledge base et DLC réelle.
RECEIPT_PROMPT = """Tu analyses une photo de ticket de caisse français.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après.

Format EXACT attendu :
{
  "purchase_date": "YYYY-MM-DD",
  "items": [
    {
      "raw_title": "libellé exact visible sur le ticket (ex: LAI 1/2 ECR 1L)",
      "name": "nom normalisé lisible en français (ex: Lait demi-écrémé 1L)",
      "category": "frais|proteines|legumes|feculents|desserts|boissons|epicerie|autres"
    }
  ]
}

Règles :
- "purchase_date" : date d'achat visible sur le ticket au format YYYY-MM-DD, ou null si absente.
- "raw_title" : copie fidèle du libellé brut imprimé sur le ticket.
- "name" : version normalisée, lisible, en français.
- "category" : valeur EXACTE parmi : frais, proteines, legumes, feculents, desserts, boissons, epicerie, autres.
- Inclure UNIQUEMENT les articles alimentaires.
- Ignorer les articles non alimentaires (ménager, hygiène, vêtements, etc.).
- Si aucun article alimentaire n'est visible : { "purchase_date": null, "items": [] }"""

# Modèle configurable sans redéploiement. gemini-2.0-flash-lite est le successeur
# léger de gemini-1.5-flash (déprécié fin 2025).
_DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite"

# Timeout réseau explicite : connect court, read long (inférence Gemini ~10-40s)
_OCR_TIMEOUT = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=5.0)

_MAX_IMAGE_B64_LEN = 5_500_000  # ~4 MB décodé

# Regex pour normaliser une date ticket en ISO (ex: "15/01/2024" → "2024-01-15")
_DATE_DMY_RE = re.compile(r"^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$")


def _strip_data_uri_prefix(b64: str) -> str:
    """Supprime le préfixe data:...;base64, si présent (galerie iOS/Android)."""
    if "base64," in b64:
        return b64.split("base64,", 1)[1]
    return b64


def _detect_mime_type(b64_data: str) -> str:
    """Détecte le mime_type réel de l'image à partir des magic bytes.

    Évite de passer image/jpeg à Gemini si l'image est PNG ou WEBP,
    ce qui provoquerait un rejet silencieux du provider.
    """
    try:
        raw = base64.b64decode(b64_data[:40] + "==", validate=False)
    except Exception:
        return "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(raw) >= 12 and raw[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def _extract_gemini_text(data: dict) -> str | None:
    """Extrait le texte de la réponse Gemini de façon défensive.

    Retourne None si la réponse est vide (candidats ou parts absents).
    Lève OcrApiError si Gemini a bloqué la requête (SAFETY, etc.).
    """
    # Vérification du blocage au niveau du prompt
    block_reason = (data.get("promptFeedback") or {}).get("blockReason")
    if block_reason:
        raise OcrApiError(f"Gemini a bloqué la requête ({block_reason})")

    candidates = data.get("candidates") or []
    if not candidates:
        return None

    candidate = candidates[0]
    finish_reason = candidate.get("finishReason", "")
    if finish_reason in ("SAFETY", "RECITATION", "PROHIBITED_CONTENT"):
        raise OcrApiError(f"Gemini a refusé de traiter l'image ({finish_reason})")

    parts = (candidate.get("content") or {}).get("parts") or []
    if not parts:
        return None

    text = parts[0].get("text", "")
    return text.strip() if text else None


def _normalize_date(raw_date: str | None) -> str | None:
    """Normalise une date ticket vers ISO YYYY-MM-DD.

    Accepte : "YYYY-MM-DD" (déjà correct), "DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YYYY".
    Retourne None si invalide.
    """
    if not raw_date:
        return None
    raw_date = str(raw_date).strip()
    # Déjà ISO
    try:
        date.fromisoformat(raw_date)
        return raw_date
    except ValueError:
        pass
    # Format JJ/MM/AAAA
    m = _DATE_DMY_RE.match(raw_date)
    if m:
        try:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return date(y, mo, d).isoformat()
        except ValueError:
            pass
    return None


def _parse_receipt_json(text: str) -> tuple[str | None, list[dict]]:
    """Parse le texte retourné par Gemini → (purchase_date, items).

    Accepte :
    - Format v2 : { "purchase_date": "...", "items": [...] }
    - Format v1 (compat) : [ {...}, ... ]
    - Réponse enveloppée dans des blocs markdown ```json ... ```

    Lève OcrApiError(502) si le JSON est invalide ou la structure inattendue.
    """
    # Strip markdown éventuel (```json ... ```)
    if "```" in text:
        parts = text.split("```")
        # Trouver le premier bloc non vide après ```
        for part in parts[1:]:
            candidate = part.strip()
            if candidate.startswith("json"):
                candidate = candidate[4:].strip()
            if candidate:
                text = candidate
                break

    try:
        parsed = json.loads(text)
    except Exception:
        raise OcrApiError("Réponse OCR invalide (JSON inattendu)", http_status=502)

    # Format v2 : objet avec "items"
    if isinstance(parsed, dict):
        raw_date = parsed.get("purchase_date")
        purchase_date = _normalize_date(raw_date)
        items = parsed.get("items", [])
        if not isinstance(items, list):
            raise OcrApiError("Réponse OCR invalide (items n'est pas un tableau)", http_status=502)
        return purchase_date, items

    # Format v1 : tableau direct (compat descendante)
    if isinstance(parsed, list):
        return None, parsed

    raise OcrApiError("Réponse OCR invalide (objet ou tableau attendu)", http_status=502)


def _compute_expiry(purchase_date_str: str | None, shelf_days: int | None) -> str | None:
    """Calcule la date d'expiration : date_achat + durée_conservation.

    Retourne None si la date d'achat ou la durée est absente/invalide.
    """
    if not purchase_date_str or not shelf_days:
        return None
    try:
        return (date.fromisoformat(purchase_date_str) + timedelta(days=shelf_days)).isoformat()
    except Exception:
        return None


async def _enrich_normalizations(col: Any, items: list[dict]) -> None:
    """Enrichit la base de connaissances raw_title → normalized_name dans MongoDB.

    Silencieux si la collection est None ou si un item n'a pas de raw_title.
    """
    now = utc_now()
    for item in items:
        raw = item.get("raw_title", "").strip()
        if not raw:
            continue
        await col.update_one(
            {"raw_title": raw.lower()},
            {
                "$set": {
                    "normalized_name": item.get("name", ""),
                    "category": item.get("category", "autres"),
                    "last_seen_at": now,
                },
                "$inc": {"seen_count": 1},
                "$setOnInsert": {"first_seen_at": now},
            },
            upsert=True,
        )


async def ocr_receipt(
    request: Request,
    current_user: dict[str, Any],
    normalizations_col: Any = None,
) -> list[dict[str, Any]]:
    gemini_key = os.environ.get("GEMINI_OCR_API_KEY", "")
    if not gemini_key:
        logger.warning("GEMINI_OCR_API_KEY non configuré — scan ticket désactivé")
        raise OcrApiError("Service OCR non configuré sur ce serveur")

    gemini_model = os.environ.get("GEMINI_OCR_MODEL", _DEFAULT_GEMINI_MODEL)

    body = await request.json()
    image_b64: str = body.get("image", "")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Champ 'image' manquant")

    # Normalisation : supprimer le préfixe data URI si présent (galerie iOS)
    image_b64 = _strip_data_uri_prefix(image_b64)

    if len(image_b64) > _MAX_IMAGE_B64_LEN:
        raise HTTPException(status_code=413, detail="Image trop grande (max ~4 MB décodé)")

    # Validation rapide du base64 avant l'appel réseau
    try:
        base64.b64decode(image_b64[:64] + "==", validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="Image base64 invalide")

    mime_type = _detect_mime_type(image_b64)
    logger.info(
        "OCR receipt start — user=%s model=%s mime=%s b64_len=%d",
        current_user["id"], gemini_model, mime_type, len(image_b64),
    )

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{gemini_model}:generateContent?key={gemini_key}"
    )

    # ── Appel Gemini ──────────────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=_OCR_TIMEOUT) as http_client:
            response = await http_client.post(
                url,
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{
                        "parts": [
                            {"text": RECEIPT_PROMPT},
                            {"inline_data": {"mime_type": mime_type, "data": image_b64}},
                        ],
                    }],
                    "generationConfig": {
                        "maxOutputTokens": 2048,
                    },
                },
            )
    except httpx.TimeoutException as exc:
        logger.warning(
            "OCR receipt timeout — user=%s model=%s: %s",
            current_user["id"], gemini_model, exc,
        )
        raise OcrApiError(
            "Timeout lors de l'appel OCR (>45s) — réessayez dans quelques secondes",
            http_status=504,
        ) from exc
    except httpx.RequestError as exc:
        logger.warning(
            "OCR receipt network error — user=%s model=%s: %s",
            current_user["id"], gemini_model, exc,
        )
        raise OcrApiError(
            f"Erreur réseau lors de l'appel OCR : {type(exc).__name__}",
            http_status=502,
        ) from exc

    # ── Gestion des erreurs HTTP Gemini ───────────────────────────────────────
    if response.status_code != 200:
        body_preview = response.text[:400]
        logger.warning(
            "Gemini OCR HTTP %s — user=%s model=%s body=%s",
            response.status_code, current_user["id"], gemini_model, body_preview,
        )
        if response.status_code == 429:
            raise OcrApiError(
                "Quota Gemini dépassé (rate limit 429) — réessayez dans quelques secondes",
                http_status=429,
            )
        if response.status_code in (401, 403):
            raise OcrApiError(
                f"Clé API Gemini invalide ou non autorisée (HTTP {response.status_code})",
                http_status=502,
            )
        if response.status_code == 404:
            raise OcrApiError(
                f"Modèle Gemini '{gemini_model}' introuvable (HTTP 404)"
                " — vérifiez GEMINI_OCR_MODEL sur Render",
                http_status=502,
            )
        raise OcrApiError(
            f"Gemini a retourné HTTP {response.status_code}",
            http_status=502,
        )

    # ── Parsing de la réponse ─────────────────────────────────────────────────
    try:
        resp_json = response.json()
    except Exception as exc:
        logger.warning(
            "OCR receipt: réponse Gemini non-JSON — user=%s body=%s",
            current_user["id"], response.text[:400],
        )
        raise OcrApiError("Réponse OCR illisible (non-JSON)", http_status=502) from exc

    try:
        text = _extract_gemini_text(resp_json)
    except OcrApiError:
        raise
    except Exception as exc:
        logger.warning(
            "OCR receipt: extraction texte Gemini — user=%s resp=%s exc=%s",
            current_user["id"], str(resp_json)[:400], exc,
        )
        raise OcrApiError(
            f"Structure de réponse Gemini inattendue : {exc}",
            http_status=502,
        ) from exc

    if not text:
        logger.info(
            "OCR receipt — user=%s model=%s → réponse vide (aucun produit détecté)",
            current_user["id"], gemini_model,
        )
        return []

    # ── Parse du JSON ticket ───────────────────────────────────────────────────
    try:
        purchase_date, raw_items = _parse_receipt_json(text)
    except OcrApiError:
        logger.warning(
            "OCR receipt: JSON parse failed — user=%s raw=%s",
            current_user["id"], text[:200],
        )
        raise

    if not raw_items:
        logger.info(
            "OCR receipt — user=%s model=%s → liste vide (aucun produit alimentaire)",
            current_user["id"], gemini_model,
        )
        return []

    # ── Construction de la réponse enrichie ───────────────────────────────────
    result: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        category = item.get("category", "autres")
        if category not in SHELF_BY_CATEGORY:
            category = "autres"
        shelf = SHELF_BY_CATEGORY[category]
        result.append({
            "name": item["name"],
            "raw_title": item.get("raw_title", ""),
            "purchase_date": purchase_date,
            "category": category,
            "food_category": category,
            "shelf_life_fridge": shelf["fridge"],
            "shelf_life_pantry": shelf["pantry"],
            "shelf_life_freezer": shelf["freezer"],
            "expiry_date_fridge": _compute_expiry(purchase_date, shelf["fridge"]),
            "expiry_date_pantry": _compute_expiry(purchase_date, shelf["pantry"]),
            "expiry_date_freezer": _compute_expiry(purchase_date, shelf["freezer"]),
        })

    # ── Enrichissement knowledge base (silencieux si erreur) ──────────────────
    if normalizations_col is not None and result:
        try:
            await _enrich_normalizations(normalizations_col, result)
        except Exception as exc:
            logger.warning(
                "OCR normalization enrich failed — user=%s: %s",
                current_user["id"], exc,
            )

    logger.info(
        "OCR receipt done — user=%s model=%s products=%d purchase_date=%s",
        current_user["id"], gemini_model, len(result), purchase_date,
    )
    return result
