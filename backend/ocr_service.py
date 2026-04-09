from __future__ import annotations

import json
import os
from typing import Any

import httpx
from fastapi import HTTPException, Request

from app_core import logger

class OcrApiError(RuntimeError):
    """Levée quand l'appel Gemini échoue (HTTP error, timeout, JSON invalide, clé absente)."""


SHELF_BY_CATEGORY: dict[str, dict[str, int | None]] = {
    "frais": {"fridge": 7, "pantry": None, "freezer": None},
    "proteines": {"fridge": 3, "pantry": None, "freezer": 90},
    "legumes": {"fridge": 5, "pantry": None, "freezer": 365},
    "feculents": {"fridge": None, "pantry": 365, "freezer": None},
    "desserts": {"fridge": 5, "pantry": 180, "freezer": 90},
    "boissons": {"fridge": 7, "pantry": 365, "freezer": None},
    "epicerie": {"fridge": None, "pantry": 365, "freezer": None},
    "autres": {"fridge": None, "pantry": 365, "freezer": None},
}

RECEIPT_PROMPT = """Tu analyses une photo de ticket de caisse français.
Extrait UNIQUEMENT les produits alimentaires visibles.

Pour chaque produit retourne un objet JSON :
- "name" : nom lisible et normalisé en français (ex: "Lait demi-écrémé bio 1L")
- "category" : une valeur EXACTE parmi : frais, proteines, legumes, feculents, desserts, boissons, epicerie, autres

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou après.
Si aucun produit alimentaire n'est visible, retourne [].
Ignore les articles non alimentaires (ménager, hygiène, etc.)."""


async def ocr_receipt(request: Request, current_user: dict[str, Any]) -> list[dict[str, Any]]:
    gemini_key = os.environ.get("GEMINI_OCR_API_KEY", "")
    if not gemini_key:
        logger.warning("GEMINI_OCR_API_KEY non configuré — scan ticket désactivé")
        raise OcrApiError("Service OCR non configuré sur ce serveur")

    body = await request.json()
    image_b64: str = body.get("image", "")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Champ 'image' manquant")
    # Limite à ~4 MB décodé (~5.5 MB en base64) pour éviter les abus mémoire et coûts API
    _MAX_IMAGE_B64_LEN = 5_500_000
    if len(image_b64) > _MAX_IMAGE_B64_LEN:
        raise HTTPException(status_code=413, detail="Image trop grande (max 4 MB)")

    try:
        async with httpx.AsyncClient(timeout=30) as http_client:
            response = await http_client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{
                        "parts": [
                            {"text": RECEIPT_PROMPT},
                            {"inline_data": {"mime_type": "image/jpeg", "data": image_b64}},
                        ],
                    }],
                    "generationConfig": {
                        "maxOutputTokens": 1024,
                        "responseMimeType": "application/json",
                    },
                },
            )
            if response.status_code != 200:
                logger.warning("Gemini receipt OCR error %s: %s", response.status_code, response.text[:200])
                raise OcrApiError(f"Gemini a retourné une erreur HTTP {response.status_code}")
            text = response.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    except OcrApiError:
        raise
    except Exception as exc:
        logger.warning("Gemini request failed: %s", exc)
        raise OcrApiError(f"Impossible de contacter le service OCR : {exc}") from exc

    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        products: list[dict[str, Any]] = json.loads(text)
    except Exception:
        logger.warning("OCR receipt: JSON parse failed — raw=%s", text[:200])
        raise OcrApiError("Réponse OCR invalide (JSON inattendu)")

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

    logger.info("Receipt OCR — user=%s products=%d", current_user["id"], len(result))
    return result
