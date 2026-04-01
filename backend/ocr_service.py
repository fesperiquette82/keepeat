from __future__ import annotations

import json
import os
from typing import Any

import httpx
from fastapi import HTTPException, Request

from app_core import logger

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
    openai_key = os.environ.get("KEEPEAT_OPENAI_TOKEN", "")
    if not openai_key:
        logger.warning("KEEPEAT_OPENAI_TOKEN non configuré — scan ticket désactivé")
        return []

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
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "max_tokens": 1024,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": RECEIPT_PROMPT},
                            {"type": "image_url", "image_url": {
                                "url": f"data:image/jpeg;base64,{image_b64}",
                                "detail": "low",
                            }},
                        ],
                    }],
                },
            )
            if response.status_code != 200:
                logger.warning("OpenAI receipt OCR error %s: %s", response.status_code, response.text[:200])
                return []
            text = response.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("OpenAI request failed: %s", exc)
        return []

    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        products: list[dict[str, Any]] = json.loads(text)
    except Exception:
        logger.warning("OCR receipt: JSON parse failed — raw=%s", text[:200])
        return []

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
