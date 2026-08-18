from __future__ import annotations

import os
from typing import Optional

import httpx

from backend.app_core import logger, utc_now
from backend.models import ProductBase, ShelfLife

OFF_USER_AGENT = os.getenv("OFF_USER_AGENT", "KeepEat/1.0 (https://keepeat.app)")


async def lookup_product_openfoodfacts(barcode: str, products_cache_col) -> Optional[ProductBase]:
    cached = await products_cache_col.find_one({"barcode": barcode})
    if cached:
        logger.info("OFF cache hit barcode=%s", barcode)
        return ProductBase(**{k: v for k, v in cached.items() if k in ProductBase.model_fields})

    product: Optional[ProductBase] = None
    # conclusive=True uniquement si OFF a répondu 200 (produit présent OU définitivement
    # absent). Une panne réseau / un non-200 transitoire NE doit PAS être mis en cache,
    # sinon le code-barres est marqué "introuvable" de façon permanente (cf. E3).
    conclusive = False
    try:
        url = f"https://world.openfoodfacts.net/api/v2/product/{barcode}"
        headers = {"User-Agent": OFF_USER_AGENT}
        async with httpx.AsyncClient(timeout=5.0, headers=headers) as client:
            response = await client.get(url)

        if response.status_code != 200:
            logger.info("OFF lookup failed status=%s barcode=%s", response.status_code, barcode)
        else:
            conclusive = True
            data = response.json()
            if data.get("status") == 1 and data.get("product"):
                p = data["product"]
                product = ProductBase(
                    barcode=barcode,
                    name=p.get("product_name") or p.get("product_name_fr") or "Produit inconnu",
                    brand=p.get("brands", "") or "",
                    image_url=p.get("image_front_small_url") or p.get("image_url") or "",
                    category=(p.get("categories_tags") or [None])[0],
                    quantity=p.get("quantity", "") or "",
                )
    except Exception as exc:
        logger.warning("OFF lookup exception barcode=%s err=%s", barcode, exc)

    # On ne persiste que les résultats concluants : un échec réseau/non-200 laisse le
    # cache vide pour permettre un nouvel essai au prochain scan.
    if conclusive:
        try:
            doc = {"barcode": barcode, "cached_at": utc_now()}
            if product:
                doc.update(product.model_dump())
                doc["found"] = True
            else:
                doc["found"] = False
            await products_cache_col.update_one({"barcode": barcode}, {"$set": doc}, upsert=True)
        except Exception as exc:
            logger.warning("OFF cache write failed barcode=%s err=%s", barcode, exc)

    return product


async def search_openfoodfacts_by_name(
    name: str,
    brand: Optional[str],
    products_cache_col,
) -> Optional[str]:
    """Recherche une image produit sur OpenFoodFacts par nom (pas de code-barres
    disponible — cas des articles issus de l'OCR d'un ticket de caisse).

    Retourne l'URL du premier résultat exploitable, ou None si rien de concluant.
    Résultat mis en cache (positif ou négatif) dans products_cache_col, keyé par
    la requête normalisée (`name_query`), pour ne pas re-interroger OFF à chaque
    ticket contenant le même produit.
    """
    query = " ".join(part.strip() for part in (brand, name) if part and part.strip())
    if not query:
        return None
    cache_key = query.lower()

    cached = await products_cache_col.find_one({"name_query": cache_key})
    if cached:
        logger.info("OFF name-search cache hit query=%s", cache_key)
        return cached.get("image_url") or None

    image_url: Optional[str] = None
    # Comme pour lookup_product_openfoodfacts (cf. E3) : on ne met en cache que les
    # résultats concluants (réponse HTTP 200), jamais un échec réseau/transitoire.
    conclusive = False
    try:
        url = "https://world.openfoodfacts.org/cgi/search.pl"
        params = {
            "search_terms": query,
            "search_simple": "1",
            "action": "process",
            "json": "1",
            "page_size": "5",
            "fields": "product_name,image_front_small_url,image_url,image_small_url,image_thumb_url",
        }
        headers = {"User-Agent": OFF_USER_AGENT}
        async with httpx.AsyncClient(timeout=5.0, headers=headers) as client:
            response = await client.get(url, params=params)

        if response.status_code != 200:
            logger.info("OFF name-search failed status=%s query=%s", response.status_code, cache_key)
        else:
            conclusive = True
            data = response.json()
            for p in data.get("products") or []:
                if not p.get("product_name"):
                    continue
                candidate = (
                    p.get("image_front_small_url")
                    or p.get("image_url")
                    or p.get("image_small_url")
                    or p.get("image_thumb_url")
                )
                if candidate:
                    image_url = candidate
                    break
    except Exception as exc:
        logger.warning("OFF name-search exception query=%s err=%s", cache_key, exc)

    if conclusive:
        try:
            await products_cache_col.update_one(
                {"name_query": cache_key},
                {"$set": {
                    "name_query": cache_key,
                    "image_url": image_url or "",
                    "cached_at": utc_now(),
                }},
                upsert=True,
            )
        except Exception as exc:
            logger.warning("OFF name-search cache write failed query=%s err=%s", cache_key, exc)

    return image_url


SHELF_LIFE_BY_KEYWORD = [
    ("milk", 7, None, None, "Produits laitiers", "Conserver au réfrigérateur après ouverture."),
    ("yogurt", 10, None, None, "Produits laitiers", "Conserver au réfrigérateur."),
    ("cheese", 14, None, None, "Produits laitiers", "Bien emballer pour éviter le dessèchement."),
    ("meat", 2, 90, None, "Viandes", "Réfrigérer rapidement et respecter la chaîne du froid."),
    ("fish", 2, 90, None, "Poissons", "À consommer rapidement après achat."),
    ("bread", 5, 30, 3, "Boulangerie", "Éviter le frigo (durcit). Congeler si besoin."),
    ("egg", 21, None, 21, "Œufs", "Conserver au frais et vérifier la fraîcheur."),
    ("pasta", None, None, 365, "Épicerie", "Stocker au sec, à l’abri de la chaleur."),
    ("rice", None, None, 365, "Épicerie", "Stocker au sec, à l’abri de l’humidité."),
]


def infer_shelf_life(product: Optional[ProductBase]) -> ShelfLife:
    name = (product.name if product else "").lower()
    brand = ((product.brand or "") if product else "").lower()
    blob = f"{name} {brand}"

    for kw, fridge, freezer, pantry, cat_fr, tips_fr in SHELF_LIFE_BY_KEYWORD:
        if kw in blob:
            return ShelfLife(
                category_fr=cat_fr,
                refrigerator_days=fridge,
                freezer_days=freezer,
                pantry_days=pantry,
                tips_fr=tips_fr,
            )

    return ShelfLife(
        category_fr="Général",
        refrigerator_days=7,
        freezer_days=90,
        pantry_days=180,
        tips_fr="Adapter selon l’emballage et respecter la chaîne du froid.",
    )


_OFF_CATEGORY_MAP: dict[str, str] = {
    "en:beverages": "boissons", "en:waters": "boissons", "en:sodas": "boissons",
    "en:juices-and-nectars": "boissons", "en:coffees": "boissons", "en:teas": "boissons",
    "en:plant-based-milks": "boissons", "en:fruit-juices": "boissons", "fr:boissons": "boissons",
    "en:dairies": "frais", "en:milks": "frais", "en:cheeses": "frais", "en:yogurts": "frais",
    "en:butters": "frais", "en:creams": "frais", "en:eggs": "frais", "fr:laits": "frais",
    "fr:yaourts": "frais", "fr:fromages": "frais", "fr:produits-laitiers": "frais",
    "en:meats": "proteines", "en:fish": "proteines", "en:seafoods": "proteines",
    "en:poultry": "proteines", "en:deli-meats": "proteines", "fr:viandes": "proteines",
    "fr:poissons": "proteines", "en:vegetables": "legumes", "en:fruits": "legumes",
    "en:fresh-vegetables": "legumes", "en:fresh-fruits": "legumes", "fr:legumes": "legumes",
    "fr:fruits": "legumes", "en:pastas": "feculents", "en:rices": "feculents",
    "en:breads": "feculents", "en:cereals-and-their-products": "feculents",
    "en:breakfast-cereals": "feculents", "fr:pates": "feculents", "fr:riz": "feculents",
    "fr:pains": "feculents", "en:sweet-snacks": "desserts", "en:chocolates": "desserts",
    "en:biscuits-and-cakes": "desserts", "en:ice-creams": "desserts",
    "en:confectioneries": "desserts", "en:desserts": "desserts", "fr:desserts": "desserts",
    "fr:chocolats": "desserts", "en:condiments": "epicerie", "en:sauces": "epicerie",
    "en:spices": "epicerie", "en:canned-foods": "epicerie", "en:soups": "epicerie",
}

_FOOD_CATEGORY_KEYWORDS: list[tuple[list[str], str]] = [
    (["jus", "juice", "soda", "cola", "limonade", "lemonade", "thé", "café", "coffee", "tea",
      "boisson", "drink", "smoothie", "sirop", "nectar", "biere", "beer", "wine", "vin",
      "eau ", "water"], "boissons"),
    (["yogurt", "yaourt", "fromage", "cheese", "beurre", "butter", "crème fraîche", "cream",
      "kéfir", "skyr", "lait", "milk", "œuf", "oeuf", "egg"], "frais"),
    (["poulet", "chicken", "bœuf", "boeuf", "beef", "porc", "pork", "agneau", "lamb",
      "dinde", "turkey", "veau", "veal", "saumon", "salmon", "thon", "tuna", "poisson", "fish",
      "crevette", "shrimp", "fruits de mer", "seafood", "jambon", "ham", "saucisse", "sausage",
      "bacon", "viande", "meat", "lardons", "merguez", "chipolata"], "proteines"),
    (["tomate", "tomato", "carotte", "carrot", "courgette", "aubergine", "eggplant", "poivron",
      "pepper", "champignon", "mushroom", "brocoli", "broccoli", "épinard", "spinach", "chou",
      "cabbage", "oignon", "onion", "ail", "garlic", "salade", "lettuce", "légume", "vegetable",
      "pomme", "apple", "banane", "banana", "orange", "citron", "lemon", "fraise", "strawberry",
      "framboise", "raspberry", "poire", "pear", "raisin", "grape", "cerise", "cherry", "ananas",
      "pineapple", "melon", "pastèque", "watermelon", "fruit", "avocat", "avocado"], "legumes"),
    (["spaghetti", "tagliatelle", "penne", "macaroni", "fusilli", "pasta", "pâte", "riz", "rice",
      "quinoa", "boulgour", "bulgur", "couscous", "semoule", "polenta", "farine", "flour", "pain",
      "bread", "baguette", "brioche", "céréale", "cereal", "muesli", "granola", "avoine", "oat",
      "blé", "wheat", "biscotte", "crackers", "biscottes"], "feculents"),
    (["chocolat", "chocolate", "gâteau", "cake", "biscuit", "cookie", "glace", "ice cream", "sorbet",
      "crème dessert", "mousse", "confiture", "jam", "miel", "honey", "nutella", "pâte à tartiner",
      "bonbon", "candy", "caramel", "tarte", "pie", "croissant", "viennoiserie", "éclair",
      "madeleine", "brownie", "compote", "sucette", "nougat", "praline", "dessert"], "desserts"),
    (["huile", "oil", "vinaigre", "vinegar", "sel", "poivre", "épice", "spice", "sauce", "ketchup",
      "moutarde", "mustard", "mayonnaise", "conserve", "soupe", "soup", "bouillon", "lentille",
      "lentil", "haricot", "bean", "pois chiche", "chickpea", "fève", "légumineuse"], "epicerie"),
]


def infer_food_category(product: Optional[ProductBase]) -> str:
    if not product:
        return "autres"

    name = (product.name or "").lower()
    brand = (product.brand or "").lower()
    off_tag = (product.category or "").lower()

    for tag, food_cat in _OFF_CATEGORY_MAP.items():
        if tag in off_tag:
            return food_cat

    blob = f"{name} {brand}"
    for keywords, food_cat in _FOOD_CATEGORY_KEYWORDS:
        if any(kw in blob for kw in keywords):
            return food_cat

    return "autres"
