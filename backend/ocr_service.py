from __future__ import annotations

import base64
import json
import os
from typing import Any

import httpx
from fastapi import HTTPException, Request

from app_core import logger


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

RECEIPT_PROMPT = """Tu analyses une photo de ticket de caisse français.
Extrait UNIQUEMENT les produits alimentaires visibles.

Pour chaque produit retourne un objet JSON :
- "name" : nom lisible et normalisé en français (ex: "Lait demi-écrémé bio 1L")
- "category" : une valeur EXACTE parmi : frais, proteines, legumes, feculents, desserts, boissons, epicerie, autres

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou après.
Si aucun produit alimentaire n'est visible, retourne [].
Ignore les articles non alimentaires (ménager, hygiène, etc.)."""

# Modèle configurable sans redéploiement. gemini-2.0-flash-lite est le successeur
# léger de gemini-1.5-flash (déprécié fin 2025).
_DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite"

# Timeout réseau explicite : connect court, read long (inférence Gemini ~10-40s)
_OCR_TIMEOUT = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=5.0)

_MAX_IMAGE_B64_LEN = 5_500_000  # ~4 MB décodé


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


async def ocr_receipt(request: Request, current_user: dict[str, Any]) -> list[dict[str, Any]]:
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
                        "maxOutputTokens": 1024,
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

    # Nettoyage du markdown éventuel dans la réponse (```json ... ```)
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        products: list[dict[str, Any]] = json.loads(text)
    except Exception:
        logger.warning(
            "OCR receipt: JSON parse failed — user=%s raw=%s",
            current_user["id"], text[:200],
        )
        raise OcrApiError("Réponse OCR invalide (JSON inattendu)", http_status=502)

    if not isinstance(products, list):
        logger.warning(
            "OCR receipt: expected list, got %s — user=%s",
            type(products).__name__, current_user["id"],
        )
        raise OcrApiError("Réponse OCR invalide (tableau attendu)", http_status=502)

    result: list[dict[str, Any]] = []
    for product in products:
        if not isinstance(product, dict) or not product.get("name"):
            continue
        category = product.get("category", "autres")
        if category not in SHELF_BY_CATEGORY:
            category = "autres"
        shelf = SHELF_BY_CATEGORY[category]
        result.append({
            "name": product["name"],
            "category": category,
            "food_category": category,
            "shelf_life_fridge": shelf["fridge"],
            "shelf_life_pantry": shelf["pantry"],
            "shelf_life_freezer": shelf["freezer"],
        })

    logger.info(
        "OCR receipt done — user=%s model=%s products=%d",
        current_user["id"], gemini_model, len(result),
    )
    return result
