from __future__ import annotations

import json
import os
from datetime import timedelta

import httpx

from app_core import logger, utc_now

_FRIGO_CATS   = ["frais", "proteines", "legumes", "boissons"]
_PLACARD_CATS = ["feculents", "desserts", "epicerie", "autres"]

# Base de ~40 recettes françaises simples et saines
_FRENCH_RECIPE_DB: list[dict] = [
    # Pâtes
    {"id": "fr001", "title": "Pâtes carbonara maison",         "category": "placard", "ingredients": ["pates", "lardons", "oeuf", "parmesan", "creme"]},
    {"id": "fr002", "title": "Pâtes à la bolognaise",          "category": "placard", "ingredients": ["pates", "boeuf", "tomate", "oignon", "ail"]},
    {"id": "fr003", "title": "Pâtes au pesto maison",          "category": "placard", "ingredients": ["pates", "basilic", "parmesan", "ail", "huile"]},
    {"id": "fr004", "title": "Gratin de pâtes au fromage",     "category": "placard", "ingredients": ["pates", "fromage", "lait", "beurre", "farine"]},
    {"id": "fr035", "title": "Minestrone de légumes",          "category": "placard", "ingredients": ["tomate", "courgette", "carotte", "oignon", "pates"]},
    # Riz / féculents
    {"id": "fr005", "title": "Riz sauté aux légumes",          "category": "placard", "ingredients": ["riz", "carotte", "oignon", "ail", "huile"]},
    {"id": "fr006", "title": "Riz au lait maison",             "category": "placard", "ingredients": ["riz", "lait", "sucre"]},
    {"id": "fr007", "title": "Risotto aux champignons",        "category": "placard", "ingredients": ["riz", "champignon", "oignon", "ail", "parmesan"]},
    {"id": "fr041", "title": "Taboulé maison",                 "category": "placard", "ingredients": ["semoule", "tomate", "concombre", "oignon", "citron"]},
    # Oeufs
    {"id": "fr008", "title": "Omelette aux herbes",            "category": "frigo",   "ingredients": ["oeuf", "beurre"]},
    {"id": "fr009", "title": "Oeufs brouillés crémeux",        "category": "frigo",   "ingredients": ["oeuf", "beurre", "creme"]},
    {"id": "fr010", "title": "Quiche lorraine",                "category": "frigo",   "ingredients": ["oeuf", "lardons", "creme", "fromage"]},
    {"id": "fr011", "title": "Frittata aux légumes",           "category": "frigo",   "ingredients": ["oeuf", "courgette", "poivron", "oignon"]},
    {"id": "fr037", "title": "Crêpes sucrées",                 "category": "placard", "ingredients": ["farine", "oeuf", "lait", "sucre", "beurre"]},
    # Poulet
    {"id": "fr012", "title": "Poulet rôti aux herbes",         "category": "frigo",   "ingredients": ["poulet", "ail", "citron", "huile"]},
    {"id": "fr013", "title": "Sauté de poulet aux légumes",    "category": "frigo",   "ingredients": ["poulet", "carotte", "oignon", "ail", "tomate"]},
    {"id": "fr014", "title": "Poulet au curry doux",           "category": "frigo",   "ingredients": ["poulet", "curry", "oignon", "tomate", "creme"]},
    {"id": "fr015", "title": "Poulet à la moutarde",           "category": "frigo",   "ingredients": ["poulet", "moutarde", "creme", "oignon"]},
    # Poisson
    {"id": "fr016", "title": "Saumon grillé citron-herbes",    "category": "frigo",   "ingredients": ["saumon", "citron", "huile"]},
    {"id": "fr017", "title": "Cabillaud en papillote",         "category": "frigo",   "ingredients": ["cabillaud", "citron", "tomate"]},
    {"id": "fr018", "title": "Salade niçoise au thon",         "category": "frigo",   "ingredients": ["thon", "tomate", "oeuf", "haricot", "oignon"]},
    # Légumes
    {"id": "fr019", "title": "Ratatouille provençale",         "category": "frigo",   "ingredients": ["courgette", "aubergine", "tomate", "poivron", "oignon"]},
    {"id": "fr020", "title": "Gratin dauphinois",              "category": "frigo",   "ingredients": ["pomme de terre", "creme", "ail", "fromage"]},
    {"id": "fr021", "title": "Poêlée de courgettes à l'ail",   "category": "frigo",   "ingredients": ["courgette", "ail", "huile"]},
    {"id": "fr022", "title": "Carottes glacées au miel",       "category": "frigo",   "ingredients": ["carotte", "miel", "beurre"]},
    {"id": "fr023", "title": "Soupe de légumes maison",        "category": "frigo",   "ingredients": ["carotte", "pomme de terre", "oignon", "poireau"]},
    {"id": "fr024", "title": "Velouté de courgettes",          "category": "frigo",   "ingredients": ["courgette", "oignon", "creme"]},
    {"id": "fr025", "title": "Purée de carottes",              "category": "frigo",   "ingredients": ["carotte", "beurre", "creme"]},
    {"id": "fr036", "title": "Soupe à l'oignon gratinée",      "category": "frigo",   "ingredients": ["oignon", "pain", "fromage", "beurre"]},
    {"id": "fr042", "title": "Salade composée",                "category": "frigo",   "ingredients": ["tomate", "concombre", "oignon", "huile", "vinaigre"]},
    # Légumineuses
    {"id": "fr026", "title": "Lentilles à la française",       "category": "placard", "ingredients": ["lentilles", "lardons", "carotte", "oignon", "ail"]},
    {"id": "fr027", "title": "Curry de pois chiches",          "category": "placard", "ingredients": ["pois chiches", "tomate", "oignon", "ail", "curry"]},
    {"id": "fr028", "title": "Salade de lentilles vinaigrette","category": "placard", "ingredients": ["lentilles", "oignon", "moutarde", "vinaigre"]},
    # Viande rouge
    {"id": "fr029", "title": "Hachis parmentier",              "category": "frigo",   "ingredients": ["boeuf", "pomme de terre", "oignon", "lait", "beurre"]},
    {"id": "fr030", "title": "Steak haché sauce tomate",       "category": "frigo",   "ingredients": ["boeuf", "tomate", "oignon", "ail"]},
    {"id": "fr031", "title": "Porc sauté aux légumes",         "category": "frigo",   "ingredients": ["porc", "carotte", "oignon", "ail"]},
    # Fromage / charcuterie
    {"id": "fr032", "title": "Croque-monsieur",                "category": "frigo",   "ingredients": ["pain", "jambon", "fromage", "beurre"]},
    {"id": "fr033", "title": "Tarte tomate mozzarella",        "category": "frigo",   "ingredients": ["tomate", "mozzarella", "oeuf", "creme"]},
    {"id": "fr034", "title": "Salade caprese",                 "category": "frigo",   "ingredients": ["tomate", "mozzarella", "huile"]},
    # Desserts
    {"id": "fr038", "title": "Mousse au chocolat",             "category": "frigo",   "ingredients": ["chocolat", "oeuf", "sucre", "beurre"]},
    {"id": "fr039", "title": "Tarte aux pommes",               "category": "placard", "ingredients": ["pomme", "farine", "beurre", "sucre", "oeuf"]},
    {"id": "fr040", "title": "Yaourt maison",                  "category": "frigo",   "ingredients": ["lait", "yaourt"]},
]

# Dictionnaire FR → EN pour les alertes quotidiennes (daily alert, _check_daily_expiry_alert)
_FR_EN: dict[str, str] = {
    "pomme de terre": "potato", "pommes de terre": "potato",
    "sauce tomate": "tomato", "petits pois": "peas",
    "pois chiche": "chickpeas", "patate douce": "sweet potato",
    "poulet": "chicken", "boeuf": "beef", "porc": "pork",
    "veau": "veal", "agneau": "lamb", "dinde": "turkey",
    "saumon": "salmon", "thon": "tuna", "cabillaud": "cod",
    "crevettes": "shrimp", "jambon": "ham", "lardons": "bacon",
    "saucisse": "sausage", "merguez": "sausage",
    "lait": "milk", "beurre": "butter", "fromage": "cheese",
    "oeuf": "egg", "oeufs": "egg",
    "yaourt": "yogurt", "creme": "cream",
    "mozzarella": "mozzarella", "parmesan": "parmesan",
    "tomate": "tomato", "carotte": "carrot", "oignon": "onion",
    "ail": "garlic", "echalote": "shallot", "courgette": "zucchini",
    "aubergine": "aubergine", "poivron": "pepper",
    "epinard": "spinach", "brocoli": "broccoli",
    "champignon": "mushroom", "poireau": "leek",
    "haricot": "green beans", "lentille": "lentils", "lentilles": "lentils",
    "pates": "pasta", "riz": "rice", "pain": "bread", "farine": "flour",
    "quinoa": "quinoa", "semoule": "semolina",
    "pomme": "apple", "banane": "banana", "citron": "lemon",
    "orange": "orange", "fraise": "strawberry", "fraises": "strawberry",
    "mangue": "mango", "ananas": "pineapple", "avocat": "avocado",
    "huile": "olive oil", "vinaigre": "vinegar", "moutarde": "mustard",
    "chocolat": "chocolate", "sucre": "sugar", "miel": "honey",
}


_CATEGORY_TO_EN: dict[str, str] = {
    "frais": "milk", "proteines": "chicken", "legumes": "tomato",
    "feculents": "pasta", "desserts": "chocolate", "boissons": "milk",
    "epicerie": "garlic", "autres": "egg",
}

def fr_to_en_ingredient(name: str, category: str = "autres") -> str:
    """Convertit un nom de produit français en ingrédient anglais (pour les alertes quotidiennes)."""
    norm = _ud.normalize("NFD", name.lower())
    norm = "".join(c for c in norm if _ud.category(c) != "Mn")
    for fr_word in sorted(_FR_EN, key=len, reverse=True):
        fr_norm = _ud.normalize("NFD", fr_word)
        fr_norm = "".join(c for c in fr_norm if _ud.category(c) != "Mn")
        if fr_norm in norm:
            return _FR_EN[fr_word]
    return _CATEGORY_TO_EN.get(category, "chicken")


_RECIPE_MATCH_THRESHOLD = 0.2  # Sous ce score → aucune correspondance utile → fallback IA

_AI_SUGGEST_PROMPT = """\
Tu es un chef cuisinier français spécialisé en cuisine du quotidien. \
Génère 1 recette de cuisine FRANÇAISE simple et saine avec ces ingrédients :
{ingredients}

Retourne UNIQUEMENT ce JSON (sans markdown, sans explication) :
{{"title": "nom de la recette en français", "ingredients_keywords": ["mot1", "mot2"], "instructions_summary": "..."}}

Règles IMPÉRATIVES :
- Recette de cuisine FRANÇAISE du quotidien (brasserie, bistrot, maison) — PAS de cuisine étrangère
- Simple : max 6 étapes, temps total < 45 min, ingrédients disponibles dans tout supermarché français
- Saine : éviter les fritures, privilégier légumes et protéines
- ingredients_keywords : mots-clés courts en français minuscules (ex: "poulet", "tomate")
- instructions_summary : max 80 mots, en français
"""


async def _generate_ai_recipe(stock_names: list[str], openai_key: str) -> dict | None:
    """Appelle GPT-4o-mini pour générer 1 recette française depuis les ingrédients du stock.
    Retourne None en cas d'échec ou si KEEPEAT_OPENAI_TOKEN n'est pas configuré.
    """
    prompt = _AI_SUGGEST_PROMPT.format(ingredients="\n".join(f"- {n}" for n in stock_names))
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                json={"model": "gpt-4o-mini", "max_tokens": 350,
                      "messages": [{"role": "user", "content": prompt}]},
            )
            if r.status_code != 200:
                logger.warning("OpenAI suggest recipe error %s: %s", r.status_code, r.text[:200])
                return None
            text = r.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("OpenAI suggest recipe failed: %s", exc)
        return None

    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        data = json.loads(text)
        if not isinstance(data.get("title"), str) or not isinstance(data.get("ingredients_keywords"), list):
            logger.warning("OpenAI suggest recipe invalid structure: %s", text[:200])
            return None
        return data
    except Exception:
        logger.warning("OpenAI suggest recipe invalid JSON: %s", text[:200])
        return None


# Synonymes et variantes produits → mot-clé recette
# Permet de matcher "Gruyère" → "fromage", "Steak haché" → "boeuf", "Spaghetti" → "pates", etc.
_ING_EXPAND: dict[str, list[str]] = {
    "fromage":        ["gruyere", "emmental", "comte", "cheddar", "camembert", "brie", "chevre",
                       "roquefort", "raclette", "tomme", "mimolette", "coulommiers", "maroilles",
                       "reblochon", "munster", "ossau", "beaufort", "feta", "ricotta"],
    "boeuf":          ["steak", "hache", "bifteck", "entrecote", "bavette", "rumsteck", "bourguignon",
                       "viande", "tartare", "roti", "braise"],
    "lardons":        ["bacon", "poitrine", "pancetta", "fumee", "allumettes"],
    "creme":          ["fraiche", "fleurette", "liquide", "epaisse", "semi-epaisse", "entiere"],
    "pates":          ["spaghetti", "penne", "fusilli", "tagliatelle", "linguine", "rigatoni",
                       "macaroni", "farfalle", "coquillette", "vermicelle", "lasagne", "gnocchi"],
    "poulet":         ["blanc", "cuisse", "escalope", "filet", "aiguillette", "cocotte"],
    "porc":           ["cochon", "longe", "chop", "filet mignon", "cote", "rillette"],
    "saumon":         ["pavé", "truite"],
    "pomme de terre": ["patate", "vitelotte", "ratte", "charlotte", "grenaille"],
    "riz":            ["basmati", "arborio", "rond", "long"],
    "oeuf":           ["oeufs", "oeuf"],
    "tomate":         ["tomates", "cherry", "cerises", "concassee", "pelees"],
    "carotte":        ["carottes"],
    "champignon":     ["champignons", "shiitake", "portobello", "girolles", "cèpes", "cepes"],
    "oignon":         ["oignons", "echalote", "echalotes", "cive", "ciboulette"],
    "ail":            ["gousses"],
    "poisson":        ["merlu", "lieu", "daurade", "bar", "sole", "cabillaud", "tilapia", "pangasius"],
    "lentilles":      ["lentille", "beluga", "corail", "verte", "puy"],
    "pois chiches":   ["pois chiche", "chickpeas"],
    "courgette":      ["courgettes", "zucchini"],
    "aubergine":      ["aubergines"],
    "poivron":        ["poivrons", "capsicum"],
    "concombre":      ["concombres"],
}


def _normalize_fr(text: str) -> str:
    """Minuscule + suppression des accents."""
    n = _ud.normalize("NFD", text.lower())
    return "".join(c for c in n if _ud.category(c) != "Mn")


def _match_recipe_to_stock(
    recipe: dict,
    norm_stock: list[str],
    norm_urgent: set[str],
    boost_urgent: bool,
) -> tuple[float, list[str], list[str]]:
    """Retourne (score, ingrédients_utilisés, ingrédients_manquants).

    Score = nb_ingrédients_trouvés / nb_total + bonus urgence.
    Correspondance bidirectionnelle : le mot-clé recette dans le nom produit OU vice-versa.
    """
    used: list[str] = []
    missed: list[str] = []
    has_urgent_match = False

    for ing in recipe["ingredients"]:
        norm_ing = _normalize_fr(ing)
        ing_words = [w for w in norm_ing.split() if len(w) > 2]
        # Synonymes/variantes produits (ex: "fromage" → gruyere, emmental…)
        synonyms = [_normalize_fr(s) for s in _ING_EXPAND.get(ing, [])]
        found = False
        for ns in norm_stock:
            if (norm_ing in ns
                    or any(w in ns for w in ing_words)
                    or any(syn in ns for syn in synonyms)):
                found = True
                if ing not in used:
                    used.append(ing)
                if boost_urgent and any(norm_ing in nu or nu in norm_ing for nu in norm_urgent):
                    has_urgent_match = True
                break
        if not found:
            missed.append(ing)

    n_total = len(recipe["ingredients"])
    if n_total == 0:
        return 0.0, [], []

    score = len(used) / n_total
    if has_urgent_match:
        score += 0.3  # Boost si au moins un ingrédient urgent est utilisé
    return score, used, missed
