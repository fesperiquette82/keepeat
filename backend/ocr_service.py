from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from datetime import date, timedelta
from typing import Any

import httpx
from fastapi import HTTPException, Request

from backend.app_core import logger, utc_now
from backend.food_defaults_service import enrich_food_defaults_from_static


class OcrApiError(RuntimeError):
    """Levée quand l'appel Gemini échoue.

    http_status indique le code HTTP à retourner au client :
    - 502 : erreur provider (réponse non-200, modèle introuvable, parse invalide)
    - 504 : timeout provider
    - 429 : quota / rate-limit provider
    """

    def __init__(
        self,
        message: str,
        http_status: int = 502,
        *,
        stage: str | None = None,
        upstream_status: int | None = None,
        mime_type: str | None = None,
        image_b64_len: int | None = None,
        cause: str | None = None,
    ):
        super().__init__(message)
        self.http_status = http_status
        self.stage = stage
        self.upstream_status = upstream_status
        self.mime_type = mime_type
        self.image_b64_len = image_b64_len
        self.cause = cause


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

# Prompt v3 : structure stricte avec produits ignorés et champs d'estimation explicites.
RECEIPT_PROMPT = """Tu analyses UNE PHOTO DE TICKET DE CAISSE.
Tu dois extraire les lignes produits visibles SANS inventer.

Réponds avec UN OBJET JSON STRICT, valide, sans markdown et sans texte hors JSON.

Schéma obligatoire :
{
  "purchase_date": "YYYY-MM-DD ou null",
  "merchant": "string ou null",
  "currency": "string ou null",
  "items": [
    {
      "raw_title": "libellé exact ticket",
      "normalized_title": "nom normalisé lisible en français",
      "brand": "marque si lisible sur le ticket sinon null",
      "is_food": true,
      "quantity": 1,
      "unit": "unit|kg|g|l|ml|pack|piece",
      "category": "frais|proteines|legumes|feculents|desserts|boissons|epicerie|autres",
      "estimated_shelf_life_days": 7,
      "estimated_expiration_date": "YYYY-MM-DD ou null",
      "confidence": 0.0
    }
  ],
  "ignored_items": [
    {
      "raw_title": "libellé exact ticket",
      "reason": "non_food|uncertain|invalid_item"
    }
  ]
}

Règles métier :
- Inclure UNIQUEMENT les produits alimentaires dans "items".
- Tout article non alimentaire va dans "ignored_items".
- purchase_date = date d'achat visible sinon null.
- estimated_expiration_date = ESTIMATION (pas une DLC lue), basée sur purchase_date + durée estimée.
- En cas d'incertitude : conserver raw_title, normaliser prudemment, confidence plus basse.
- confidence doit être entre 0 et 1.
- Si aucun produit alimentaire : "items": [].
"""

# Variante texte du prompt v3 (BUG-051 — import par email) : même schéma JSON de
# sortie que RECEIPT_PROMPT, réutilise donc telle quelle toute la normalisation en
# aval (_normalize_receipt_item, _enrich_normalizations, _enrich_images) — seule la
# nature de l'entrée change (texte d'email plutôt que photo).
EMAIL_RECEIPT_PROMPT = """Tu analyses LE TEXTE D'UN EMAIL DE TICKET DE CAISSE ÉLECTRONIQUE
(reçu dématérialisé envoyé par une enseigne à un client fidélité).
Tu dois extraire les lignes produits visibles SANS inventer.
Si ce texte ne ressemble pas à un ticket de caisse (email publicitaire, newsletter,
confirmation de commande sans détail produit, etc.), réponds avec "items": [] et
"ignored_items": [].

Réponds avec UN OBJET JSON STRICT, valide, sans markdown et sans texte hors JSON.

Schéma obligatoire :
{
  "purchase_date": "YYYY-MM-DD ou null",
  "merchant": "string ou null",
  "currency": "string ou null",
  "items": [
    {
      "raw_title": "libellé exact du ticket",
      "normalized_title": "nom normalisé lisible en français",
      "brand": "marque si lisible sinon null",
      "is_food": true,
      "quantity": 1,
      "unit": "unit|kg|g|l|ml|pack|piece",
      "category": "frais|proteines|legumes|feculents|desserts|boissons|epicerie|autres",
      "estimated_shelf_life_days": 7,
      "estimated_expiration_date": "YYYY-MM-DD ou null",
      "confidence": 0.0
    }
  ],
  "ignored_items": [
    {
      "raw_title": "libellé exact du ticket",
      "reason": "non_food|uncertain|invalid_item"
    }
  ]
}

Règles métier :
- Inclure UNIQUEMENT les produits alimentaires dans "items".
- Tout article non alimentaire va dans "ignored_items".
- purchase_date = date d'achat visible sinon null.
- estimated_expiration_date = ESTIMATION (pas une DLC lue), basée sur purchase_date + durée estimée.
- En cas d'incertitude : conserver raw_title, normaliser prudemment, confidence plus basse.
- confidence doit être entre 0 et 1.
- Si aucun produit alimentaire ou si ce n'est pas un ticket de caisse : "items": [].

Texte de l'email à analyser :
---
"""

# Modèle configurable sans redéploiement. gemini-2.0-flash-lite est le successeur
# léger de gemini-1.5-flash (déprécié fin 2025).
_DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite"

_MAX_EMAIL_TEXT_LEN = 20_000  # ~ quelques pages, largement suffisant pour un ticket

# Timeout réseau explicite : connect court, read long (inférence Gemini potentiellement lente)
_OCR_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=5.0)

_MAX_IMAGE_B64_LEN = 5_500_000  # ~4 MB décodé

# Regex pour normaliser une date ticket en ISO (ex: "15/01/2024" → "2024-01-15")
_DATE_DMY_RE = re.compile(r"^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$")
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=\s]+$")

_DEFAULT_RETRY_ATTEMPTS = 3
_RETRYABLE_HTTP_STATUSES = {429, 500, 502, 503, 504}


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
    return "invalid"


def _decode_base64_image(b64_data: str) -> bytes:
    compact = re.sub(r"\s+", "", b64_data)
    if not compact or not _BASE64_RE.match(compact):
        raise HTTPException(status_code=400, detail="Image base64 invalide")
    padding = len(compact) % 4
    if padding:
        compact += "=" * (4 - padding)
    try:
        return base64.b64decode(compact, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Image base64 invalide") from exc


def _default_zone_from_shelf(shelf: dict[str, int | None]) -> str:
    """Même règle que le frontend (receiptExpiry.ts::defaultReceiptZone) : la
    zone où l'aliment a une durée de conservation connue, frigo en priorité."""
    if shelf.get("fridge"):
        return "frigo"
    if shelf.get("pantry"):
        return "placard"
    if shelf.get("freezer"):
        return "congelateur"
    return "placard"


def _normalize_receipt_item(item: dict[str, Any], purchase_date: str | None) -> dict[str, Any] | None:
    raw_title = str(item.get("raw_title") or item.get("title") or item.get("name") or "").strip()
    normalized_title = str(item.get("normalized_title") or item.get("name") or raw_title).strip()
    if not raw_title:
        return None

    category = str(item.get("category") or "autres").strip().lower()
    if category not in SHELF_BY_CATEGORY:
        category = "autres"

    is_food = item.get("is_food")
    if not isinstance(is_food, bool):
        is_food = category != "autres" or bool(normalized_title)
    if not is_food:
        return None

    confidence_value = item.get("confidence", 0.6)
    try:
        confidence = min(1.0, max(0.0, float(confidence_value)))
    except (TypeError, ValueError):
        confidence = 0.6

    shelf = SHELF_BY_CATEGORY[category]
    estimated_shelf_life_days = item.get("estimated_shelf_life_days")
    if not isinstance(estimated_shelf_life_days, int):
        estimated_shelf_life_days = next((v for v in (shelf["fridge"], shelf["pantry"], shelf["freezer"]) if isinstance(v, int)), None)

    estimated_expiration_date = item.get("estimated_expiration_date")
    if isinstance(estimated_expiration_date, str):
        estimated_expiration_date = _normalize_date(estimated_expiration_date)
    else:
        estimated_expiration_date = None
    if estimated_expiration_date is None:
        estimated_expiration_date = _compute_expiry(purchase_date, estimated_shelf_life_days)

    quantity = item.get("quantity")
    if not isinstance(quantity, (int, float)):
        quantity = 1
    unit = item.get("unit")
    if not isinstance(unit, str) or not unit.strip():
        unit = "unit"

    brand_raw = item.get("brand")
    brand = brand_raw.strip() if isinstance(brand_raw, str) and brand_raw.strip() else None

    return {
        "name": normalized_title,
        "normalized_title": normalized_title,
        "raw_title": raw_title,
        "purchase_date": purchase_date,
        "category": category,
        "food_category": category,
        "brand": brand,
        "image_url": None,
        "quantity": quantity,
        "unit": unit.strip(),
        "confidence": confidence,
        "estimated_shelf_life_days": estimated_shelf_life_days,
        "estimated_expiration_date": estimated_expiration_date,
        "shelf_life_fridge": shelf["fridge"],
        "shelf_life_pantry": shelf["pantry"],
        "shelf_life_freezer": shelf["freezer"],
        "expiry_date_fridge": _compute_expiry(purchase_date, shelf["fridge"]),
        "expiry_date_pantry": _compute_expiry(purchase_date, shelf["pantry"]),
        "expiry_date_freezer": _compute_expiry(purchase_date, shelf["freezer"]),
        "storage_zone": _default_zone_from_shelf(shelf),
    }


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


def _parse_receipt_json(text: str) -> tuple[str | None, str | None, str | None, list[dict], list[dict]]:
    """Parse le texte retourné par Gemini.

    Accepte :
    - Format v3 : { "purchase_date": "...", "merchant": "...", "currency": "...", "items": [...], "ignored_items": [...] }
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
        merchant = parsed.get("merchant")
        if not isinstance(merchant, str):
            merchant = None
        else:
            merchant = merchant.strip() or None
        currency = parsed.get("currency")
        if not isinstance(currency, str):
            currency = "EUR"
        else:
            currency = (currency.strip() or "EUR").upper()
        items = parsed.get("items", [])
        if not isinstance(items, list):
            raise OcrApiError("Réponse OCR invalide (items n'est pas un tableau)", http_status=502)
        ignored_items = parsed.get("ignored_items", [])
        if not isinstance(ignored_items, list):
            ignored_items = []
        return purchase_date, merchant, currency, items, ignored_items

    # Format v1 : tableau direct (compat descendante)
    if isinstance(parsed, list):
        return None, None, "EUR", parsed, []

    raise OcrApiError("Réponse OCR invalide (objet ou tableau attendu)", http_status=502)


def _compute_expiry(purchase_date_str: str | None, shelf_days: int | None) -> str | None:
    """Calcule la date d'expiration : date_achat + durée_conservation.

    Si la date d'achat est absente ou invalide, la date du jour est utilisée
    comme base plutôt que de perdre l'estimation. Retourne None uniquement
    si la durée de conservation elle-même est absente/nulle.
    """
    if not shelf_days:
        return None
    base_date = utc_now().date()
    if purchase_date_str:
        try:
            base_date = date.fromisoformat(purchase_date_str)
        except Exception:
            pass
    try:
        return (base_date + timedelta(days=shelf_days)).isoformat()
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
                    "normalized_name": item.get("normalized_title") or item.get("name", ""),
                    "category": item.get("category", "autres"),
                    "last_seen_at": now,
                },
                "$inc": {"seen_count": 1},
                "$setOnInsert": {"first_seen_at": now},
            },
            upsert=True,
        )


async def _enrich_images(products_cache_col: Any, items: list[dict]) -> None:
    """Attache une image produit à chaque item via recherche OpenFoodFacts par nom
    (les articles issus d'un ticket de caisse n'ont pas de code-barres).

    Best-effort : une erreur sur un item n'empêche pas les suivants, et ne fait
    jamais échouer l'appel OCR global (cf. appel dans ocr_receipt, encapsulé).
    """
    from backend.product_catalog import search_openfoodfacts_by_name

    for item in items:
        name = item.get("normalized_title") or item.get("name") or ""
        if not name:
            continue
        try:
            image_url = await search_openfoodfacts_by_name(name, item.get("brand"), products_cache_col)
        except Exception as exc:
            logger.warning("OCR image enrich failed for item=%s: %s", name, exc)
            continue
        if image_url:
            item["image_url"] = image_url


async def ocr_receipt(
    request: Request | None,
    current_user: dict[str, Any],
    request_payload: dict[str, Any] | None = None,
    normalizations_col: Any = None,
    products_cache_col: Any = None,
    food_defaults_col: Any = None,
) -> dict[str, Any]:
    gemini_key = os.environ.get("GEMINI_OCR_API_KEY", "")
    if not gemini_key:
        logger.warning("GEMINI_OCR_API_KEY non configuré — scan ticket désactivé")
        raise OcrApiError("Service OCR non configuré sur ce serveur")

    gemini_model = os.environ.get("GEMINI_OCR_MODEL", _DEFAULT_GEMINI_MODEL)

    if request_payload is None:
        if request is None:
            raise HTTPException(status_code=422, detail="Payload JSON invalide")
        try:
            body = await request.json()
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Payload JSON invalide") from exc
    else:
        body = request_payload
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Structure de requête invalide")

    image_value = body.get("image")
    if image_value is None:
        raise HTTPException(status_code=400, detail="Champ 'image' manquant")
    if not isinstance(image_value, str):
        raise HTTPException(status_code=422, detail="Le champ 'image' doit être une chaîne base64")

    image_b64 = image_value.strip()
    if not image_b64:
        raise HTTPException(status_code=400, detail="Champ 'image' manquant")

    # Normalisation : supprimer le préfixe data URI si présent (galerie iOS)
    image_b64 = _strip_data_uri_prefix(image_b64)

    if len(image_b64) > _MAX_IMAGE_B64_LEN:
        raise HTTPException(status_code=400, detail="Image trop grande (max ~4 MB décodé)")

    _decode_base64_image(image_b64)

    mime_type = _detect_mime_type(image_b64)
    if mime_type == "invalid":
        raise HTTPException(status_code=400, detail="Mime type image non supporté (jpeg/png/webp uniquement)")
    logger.info(
        "OCR receipt start — user=%s model=%s mime=%s b64_len=%d",
        current_user["id"], gemini_model, mime_type, len(image_b64),
    )
    logger.debug(
        "OCR receipt payload diagnostics — user=%s mime=%s inline_data_b64_len=%d",
        current_user["id"], mime_type, len(image_b64),
    )

    return await _call_gemini_receipt_parser(
        gemini_key=gemini_key,
        gemini_model=gemini_model,
        parts=[
            {"text": RECEIPT_PROMPT},
            {"inlineData": {"mimeType": mime_type, "data": image_b64}},
        ],
        current_user=current_user,
        normalizations_col=normalizations_col,
        products_cache_col=products_cache_col,
        food_defaults_col=food_defaults_col,
        mime_type=mime_type,
        image_b64_len=len(image_b64),
    )


async def parse_email_receipt_text(
    *,
    current_user: dict[str, Any],
    email_text: str,
    normalizations_col: Any = None,
    products_cache_col: Any = None,
    food_defaults_col: Any = None,
) -> dict[str, Any]:
    """Variante texte de ocr_receipt() (BUG-051 — import automatique par email) :
    même pipeline Gemini + normalisation/enrichissement, mais l'entrée est le texte
    d'un email de ticket dématérialisé plutôt qu'une photo. Réutilise EMAIL_RECEIPT_PROMPT
    (même schéma JSON de sortie que RECEIPT_PROMPT)."""
    gemini_key = os.environ.get("GEMINI_OCR_API_KEY", "")
    if not gemini_key:
        logger.warning("GEMINI_OCR_API_KEY non configuré — import email désactivé")
        raise OcrApiError("Service OCR non configuré sur ce serveur")

    gemini_model = os.environ.get("GEMINI_OCR_MODEL", _DEFAULT_GEMINI_MODEL)

    text = (email_text or "").strip()
    if not text:
        return {"purchase_date": None, "merchant": None, "currency": "EUR", "items": [], "ignored_items": []}
    if len(text) > _MAX_EMAIL_TEXT_LEN:
        text = text[:_MAX_EMAIL_TEXT_LEN]

    logger.info(
        "Email receipt parse start — user=%s model=%s text_len=%d",
        current_user["id"], gemini_model, len(text),
    )

    return await _call_gemini_receipt_parser(
        gemini_key=gemini_key,
        gemini_model=gemini_model,
        parts=[{"text": EMAIL_RECEIPT_PROMPT + text}],
        current_user=current_user,
        normalizations_col=normalizations_col,
        products_cache_col=products_cache_col,
        food_defaults_col=food_defaults_col,
        mime_type=None,
        image_b64_len=None,
    )


async def _call_gemini_receipt_parser(
    *,
    gemini_key: str,
    gemini_model: str,
    parts: list[dict[str, Any]],
    current_user: dict[str, Any],
    normalizations_col: Any,
    products_cache_col: Any,
    food_defaults_col: Any = None,
    mime_type: str | None,
    image_b64_len: int | None,
) -> dict[str, Any]:
    """Logique partagée entre ocr_receipt() (photo) et parse_email_receipt_text()
    (texte d'email) : appel Gemini avec retry, parsing du JSON ticket, normalisation
    et enrichissement des articles. `mime_type`/`image_b64_len` restent None pour
    l'entrée texte — ce sont des champs de diagnostic optionnels de OcrApiError,
    déjà utilisés uniquement pour le cas image avant cette extraction."""
    # Clé passée via header x-goog-api-key (jamais en query-string) pour éviter sa
    # fuite dans les logs/traces httpx/proxy (cf. E2).
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{gemini_model}:generateContent"
    )

    provider_payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 8192,
        },
    }

    # ── Appel Gemini (retry avec backoff exponentiel sur erreurs transitoires) ──
    response: Any = None
    for attempt in range(1, _DEFAULT_RETRY_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=_OCR_TIMEOUT) as http_client:
                response = await http_client.post(
                    url,
                    headers={"Content-Type": "application/json", "x-goog-api-key": gemini_key},
                    json=provider_payload,
                )
        except httpx.TimeoutException as exc:
            logger.warning(
                "OCR receipt timeout — user=%s model=%s mime=%s b64_len=%s attempt=%d/%d err=%s",
                current_user["id"], gemini_model, mime_type, image_b64_len, attempt, _DEFAULT_RETRY_ATTEMPTS, exc,
            )
            if attempt >= _DEFAULT_RETRY_ATTEMPTS:
                raise OcrApiError(
                    "Timeout lors de l'appel OCR (>60s) — réessayez dans quelques secondes",
                    http_status=504,
                    stage="provider_call",
                    mime_type=mime_type,
                    image_b64_len=image_b64_len,
                    cause=type(exc).__name__,
                ) from exc
            backoff_seconds = float(2 ** attempt)
            logger.warning(
                "OCR receipt timeout retry backoff — user=%s model=%s wait=%.1fs next_attempt=%d/%d",
                current_user["id"], gemini_model, backoff_seconds, attempt + 1, _DEFAULT_RETRY_ATTEMPTS,
            )
            await asyncio.sleep(backoff_seconds)
            continue
        except httpx.RequestError as exc:
            logger.warning(
                "OCR receipt network error — user=%s model=%s mime=%s b64_len=%s attempt=%d/%d err=%s",
                current_user["id"], gemini_model, mime_type, image_b64_len, attempt, _DEFAULT_RETRY_ATTEMPTS, exc,
            )
            if attempt >= _DEFAULT_RETRY_ATTEMPTS:
                raise OcrApiError(
                    f"Erreur réseau lors de l'appel OCR : {type(exc).__name__}",
                    http_status=502,
                    stage="provider_call",
                    mime_type=mime_type,
                    image_b64_len=image_b64_len,
                    cause=type(exc).__name__,
                ) from exc
            backoff_seconds = float(2 ** attempt)
            logger.warning(
                "OCR receipt network retry backoff — user=%s model=%s wait=%.1fs next_attempt=%d/%d",
                current_user["id"], gemini_model, backoff_seconds, attempt + 1, _DEFAULT_RETRY_ATTEMPTS,
            )
            await asyncio.sleep(backoff_seconds)
            continue

        if response.status_code in _RETRYABLE_HTTP_STATUSES and attempt < _DEFAULT_RETRY_ATTEMPTS:
            backoff_seconds = float(2 ** attempt)
            logger.warning(
                "Gemini OCR transient HTTP %s — user=%s model=%s attempt=%d/%d wait=%.1fs",
                response.status_code, current_user["id"], gemini_model, attempt, _DEFAULT_RETRY_ATTEMPTS, backoff_seconds,
            )
            await asyncio.sleep(backoff_seconds)
            continue
        break

    if response is None:
        raise OcrApiError(
            "Échec OCR provider (aucune réponse)",
            http_status=502,
            stage="provider_call",
            mime_type=mime_type,
            image_b64_len=image_b64_len,
        )

    # ── Gestion des erreurs HTTP Gemini ───────────────────────────────────────
    if response.status_code != 200:
        body_preview = response.text[:400]
        logger.warning(
            "Gemini OCR HTTP %s — user=%s model=%s mime=%s b64_len=%s body=%s",
            response.status_code, current_user["id"], gemini_model, mime_type, image_b64_len, body_preview,
        )
        if response.status_code == 429:
            raise OcrApiError(
                "Service OCR temporairement indisponible : quota provider Gemini atteint (HTTP 429). Réessayez plus tard.",
                http_status=429,
                stage="provider_http_error",
                upstream_status=response.status_code,
                mime_type=mime_type,
                image_b64_len=image_b64_len,
                cause="provider_rate_limit",
            )
        if response.status_code in (401, 403):
            raise OcrApiError(
                f"Clé API Gemini invalide ou non autorisée (HTTP {response.status_code})",
                http_status=502,
                stage="provider_http_error",
                upstream_status=response.status_code,
                mime_type=mime_type,
                image_b64_len=image_b64_len,
                cause="provider_auth",
            )
        if response.status_code in (400, 422):
            raise OcrApiError(
                (
                    f"Image/requête OCR invalide pour le provider Gemini (HTTP {response.status_code}). "
                    "Vérifiez le format du fichier et réessayez."
                ),
                http_status=400,
                stage="provider_http_error",
                upstream_status=response.status_code,
                mime_type=mime_type,
                image_b64_len=image_b64_len,
                cause="provider_invalid_request",
            )
        if response.status_code == 404:
            raise OcrApiError(
                f"Modèle Gemini '{gemini_model}' introuvable (HTTP 404)"
                " — vérifiez GEMINI_OCR_MODEL sur Render",
                http_status=502,
                stage="provider_http_error",
                upstream_status=response.status_code,
                mime_type=mime_type,
                image_b64_len=image_b64_len,
                cause="provider_model_not_found",
            )
        raise OcrApiError(
            f"Gemini a retourné HTTP {response.status_code}",
            http_status=502,
            stage="provider_http_error",
            upstream_status=response.status_code,
            mime_type=mime_type,
            image_b64_len=image_b64_len,
            cause="provider_http_error",
        )

    # ── Parsing de la réponse ─────────────────────────────────────────────────
    try:
        resp_json = response.json()
    except Exception as exc:
        logger.warning(
            "OCR receipt: réponse Gemini non-JSON — user=%s body=%s",
            current_user["id"], response.text[:400],
        )
        raise OcrApiError(
            "Réponse OCR illisible (non-JSON)",
            http_status=502,
            stage="provider_response_parse",
            mime_type=mime_type,
            image_b64_len=image_b64_len,
            cause=type(exc).__name__,
        ) from exc

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
            stage="provider_response_parse",
            mime_type=mime_type,
            image_b64_len=image_b64_len,
            cause=type(exc).__name__,
        ) from exc

    if not text:
        logger.info(
            "OCR receipt — user=%s model=%s → réponse vide (aucun produit détecté)",
            current_user["id"], gemini_model,
        )
        return {
            "purchase_date": None,
            "merchant": None,
            "currency": "EUR",
            "items": [],
            "ignored_items": [],
        }

    # ── Parse du JSON ticket ───────────────────────────────────────────────────
    try:
        purchase_date, merchant, currency, raw_items, ignored_items = _parse_receipt_json(text)
    except OcrApiError:
        logger.warning(
            "OCR receipt: JSON parse failed — user=%s raw=%s",
            current_user["id"], text[:200],
        )
        raise OcrApiError(
            "Le modèle Gemini n'a pas renvoyé un JSON valide exploitable pour le ticket",
            http_status=502,
            stage="provider_response_parse",
            mime_type=mime_type,
            image_b64_len=image_b64_len,
            cause="invalid_model_json",
        )

    if not raw_items:
        logger.info(
            "OCR receipt — user=%s model=%s → liste vide (aucun produit alimentaire)",
            current_user["id"], gemini_model,
        )
        return {
            "purchase_date": purchase_date,
            "merchant": merchant,
            "currency": currency or "EUR",
            "items": [],
            "ignored_items": ignored_items,
        }

    # ── Construction de la réponse enrichie ───────────────────────────────────
    result: list[dict[str, Any]] = []
    normalized_ignored = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_receipt_item(item, purchase_date)
        if normalized:
            result.append(normalized)
            continue
        raw_title = str(item.get("raw_title") or item.get("title") or item.get("name") or "").strip()
        if raw_title:
            normalized_ignored.append({"raw_title": raw_title, "reason": "non_food"})

    for ignored in ignored_items:
        if not isinstance(ignored, dict):
            continue
        raw_title = str(ignored.get("raw_title") or "").strip()
        reason = str(ignored.get("reason") or "non_food").strip() or "non_food"
        if raw_title:
            normalized_ignored.append({"raw_title": raw_title, "reason": reason})

    # ── Enrichissement knowledge base (silencieux si erreur) ──────────────────
    if normalizations_col is not None and result:
        try:
            await _enrich_normalizations(normalizations_col, result)
        except Exception as exc:
            logger.warning(
                "OCR normalization enrich failed — user=%s: %s",
                current_user["id"], exc,
            )

    # ── Enrichissement cache food_defaults (zéro coût IA — catégorie déjà
    # classée par ce même appel Gemini, silencieux si erreur) ─────────────────
    if food_defaults_col is not None and result:
        try:
            await enrich_food_defaults_from_static(food_defaults_col, result)
        except Exception as exc:
            logger.warning(
                "OCR food_defaults enrich failed — user=%s: %s",
                current_user["id"], exc,
            )

    # ── Enrichissement image produit (recherche OFF par nom, silencieux) ──────
    if products_cache_col is not None and result:
        try:
            await _enrich_images(products_cache_col, result)
        except Exception as exc:
            logger.warning(
                "OCR image enrich failed — user=%s: %s",
                current_user["id"], exc,
            )

    logger.info(
        "OCR receipt done — user=%s model=%s products=%d ignored=%d purchase_date=%s merchant=%s",
        current_user["id"], gemini_model, len(result), len(normalized_ignored), purchase_date, merchant,
    )
    return {
        "purchase_date": purchase_date,
        "merchant": merchant,
        "currency": currency or "EUR",
        "items": result,
        "ignored_items": normalized_ignored,
    }
