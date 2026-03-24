from __future__ import annotations

import json
import os
import unicodedata as _ud
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import httpx
from pydantic import ValidationError

from app_core import logger
from models import Recipe, RecipeDifficulty, RecipeMealType, RecipeSuggestion

_FRIGO_CATS = ["frais", "proteines", "legumes", "boissons"]
_PLACARD_CATS = ["feculents", "desserts", "epicerie", "autres"]

_DEFAULT_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "recipes.catalog.json"
_FULLY_AVAILABLE_BONUS = 0.35
_OPTIONAL_INGREDIENT_BONUS = 0.05
_MISSING_REQUIRED_PENALTY = 0.03

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

# Synonymes et variantes produits → mot-clé recette
# Permet de matcher "Gruyère" → "fromage", "Steak haché" → "boeuf", "Spaghetti" → "pates", etc.
_ING_EXPAND: dict[str, list[str]] = {
    "fromage": ["gruyere", "emmental", "comte", "cheddar", "camembert", "brie", "chevre",
                 "roquefort", "raclette", "tomme", "mimolette", "coulommiers", "maroilles",
                 "reblochon", "munster", "ossau", "beaufort", "feta", "ricotta"],
    "boeuf": ["steak", "hache", "bifteck", "entrecote", "bavette", "rumsteck", "bourguignon",
               "viande", "tartare", "roti", "braise"],
    "lardons": ["bacon", "poitrine", "pancetta", "fumee", "allumettes"],
    "creme": ["fraiche", "fleurette", "liquide", "epaisse", "semi-epaisse", "entiere"],
    "pates": ["spaghetti", "penne", "fusilli", "tagliatelle", "linguine", "rigatoni",
               "macaroni", "farfalle", "coquillette", "vermicelle", "lasagne", "gnocchi"],
    "poulet": ["blanc", "cuisse", "escalope", "filet", "aiguillette", "cocotte"],
    "porc": ["cochon", "longe", "chop", "filet mignon", "cote", "rillette"],
    "saumon": ["pave", "truite"],
    "pomme de terre": ["patate", "vitelotte", "ratte", "charlotte", "grenaille"],
    "riz": ["basmati", "arborio", "rond", "long"],
    "oeuf": ["oeufs", "oeuf"],
    "tomate": ["tomates", "cherry", "cerises", "concassee", "pelees"],
    "carotte": ["carottes"],
    "champignon": ["champignons", "shiitake", "portobello", "girolles", "cepes"],
    "oignon": ["oignons", "echalote", "echalotes", "cive", "ciboulette"],
    "ail": ["gousses"],
    "poisson": ["merlu", "lieu", "daurade", "bar", "sole", "cabillaud", "tilapia", "pangasius"],
    "lentilles": ["lentille", "beluga", "corail", "verte", "puy"],
    "pois chiches": ["pois chiche", "chickpeas"],
    "courgette": ["courgettes", "zucchini"],
    "aubergine": ["aubergines"],
    "poivron": ["poivrons", "capsicum"],
    "concombre": ["concombres"],
}


@dataclass(slots=True)
class RecipeMatch:
    recipe: Recipe
    score: float
    used_required: list[str]
    missing_required: list[str]
    optional_used: list[str]


class RecipeCatalogError(RuntimeError):
    """Raised when the local recipe catalog cannot be loaded or validated."""


def fr_to_en_ingredient(name: str, category: str = "autres") -> str:
    """Convertit un nom de produit français en ingrédient anglais (pour les alertes quotidiennes)."""
    norm = _normalize_fr(name)
    for fr_word in sorted(_FR_EN, key=len, reverse=True):
        if _normalize_fr(fr_word) in norm:
            return _FR_EN[fr_word]
    return _CATEGORY_TO_EN.get(category, "chicken")


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


@lru_cache(maxsize=1)
def load_local_recipes(catalog_path: str | os.PathLike[str] | None = None) -> tuple[Recipe, ...]:
    """Load and validate the local recipe catalog from disk."""
    path = Path(catalog_path) if catalog_path else _DEFAULT_CATALOG_PATH
    if not path.exists():
        raise RecipeCatalogError(f"Recipe catalog not found: {path}")
    if not path.is_file():
        raise RecipeCatalogError(f"Recipe catalog path is not a file: {path}")

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RecipeCatalogError(f"Recipe catalog JSON is invalid: {exc}") from exc
    except OSError as exc:
        raise RecipeCatalogError(f"Unable to read recipe catalog: {exc}") from exc

    if not isinstance(raw, list):
        raise RecipeCatalogError("Recipe catalog root must be a list")

    recipes: list[Recipe] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw):
        try:
            recipe = Recipe.model_validate(item)
        except ValidationError as exc:
            raise RecipeCatalogError(f"Invalid recipe at index {index}: {exc}") from exc
        if recipe.id in seen_ids:
            raise RecipeCatalogError(f"Duplicate recipe id detected: {recipe.id}")
        seen_ids.add(recipe.id)
        recipes.append(recipe)

    return tuple(recipes)


def clear_recipe_catalog_cache() -> None:
    load_local_recipes.cache_clear()


def load_recipe_catalog(catalog_path: str | os.PathLike[str] | None = None) -> list[Recipe]:
    """Service function for loading the local recipe catalog."""
    return list(load_local_recipes(catalog_path))


def get_recipes_catalog(
    *,
    catalog_path: str | os.PathLike[str] | None = None,
    meal_type: str | None = None,
    difficulty: str | None = None,
    tag: str | None = None,
    cuisine: str | None = None,
    storage_focus: str | None = None,
    limit: int | None = None,
) -> list[Recipe]:
    recipes = load_recipe_catalog(catalog_path)
    if meal_type:
        recipes = [r for r in recipes if any(mt.value == meal_type for mt in r.meal_type)]
    if difficulty:
        recipes = [r for r in recipes if r.difficulty.value == difficulty]
    if tag:
        norm_tag = _normalize_fr(tag)
        recipes = [r for r in recipes if any(_normalize_fr(t) == norm_tag for t in r.tags)]
    if cuisine:
        norm_cuisine = _normalize_fr(cuisine)
        recipes = [r for r in recipes if _normalize_fr(r.cuisine.value) == norm_cuisine]
    if storage_focus:
        recipes = [r for r in recipes if storage_focus in r.compat.storage_focus]
    if limit is not None:
        recipes = recipes[:limit]
    return recipes


def _normalize_fr(text: str) -> str:
    """Minuscule + suppression des accents + trim."""
    n = _ud.normalize("NFD", text.lower().strip())
    return "".join(c for c in n if _ud.category(c) != "Mn")


normalize_ingredient_text = _normalize_fr


def _candidate_terms(raw: str) -> set[str]:
    norm = _normalize_fr(raw)
    terms = {norm}
    for token in norm.replace("-", " ").split():
        if len(token) > 2:
            terms.add(token)
    for canonical, aliases in _ING_EXPAND.items():
        canonical_norm = _normalize_fr(canonical)
        alias_norms = {_normalize_fr(alias) for alias in aliases}
        if norm == canonical_norm or norm in alias_norms or any(alias in norm for alias in alias_norms):
            terms.add(canonical_norm)
        if canonical_norm in norm:
            terms.add(canonical_norm)
        for alias_norm in alias_norms:
            if alias_norm in norm or norm in alias_norm:
                terms.add(canonical_norm)
    return terms


def normalize_stock_items(stock_items: Iterable[str | dict]) -> list[str]:
    normalized: list[str] = []
    for item in stock_items:
        if isinstance(item, dict):
            name = str(item.get("name", "")).strip()
        else:
            name = str(item).strip()
        if name:
            normalized.append(name)
    return normalized


def _match_ingredient(ingredient: str, norm_stock: list[str]) -> bool:
    norm_ing = _normalize_fr(ingredient)
    ingredient_terms = _candidate_terms(ingredient)
    for stock_name in norm_stock:
        stock_terms = _candidate_terms(stock_name)
        if norm_ing in stock_name or stock_name in norm_ing:
            return True
        if ingredient_terms & stock_terms:
            return True
    return False


def score_recipe_against_stock(recipe: Recipe, stock_items: Iterable[str | dict]) -> RecipeMatch:
    norm_stock = [_normalize_fr(item) for item in normalize_stock_items(stock_items)]

    used_required: list[str] = []
    missing_required: list[str] = []
    optional_used: list[str] = []

    for ingredient in recipe.ingredients_required:
        if _match_ingredient(ingredient, norm_stock):
            used_required.append(ingredient)
        else:
            missing_required.append(ingredient)

    for ingredient in recipe.ingredients_optional:
        if _match_ingredient(ingredient, norm_stock):
            optional_used.append(ingredient)

    required_total = len(recipe.ingredients_required)
    required_match_ratio = (len(used_required) / required_total) if required_total else 0.0
    optional_bonus = min(len(optional_used) * _OPTIONAL_INGREDIENT_BONUS, 0.15)
    missing_penalty = len(missing_required) * _MISSING_REQUIRED_PENALTY
    fully_available_bonus = _FULLY_AVAILABLE_BONUS if required_total and not missing_required else 0.0
    score = max(0.0, min(1.5, required_match_ratio + optional_bonus + fully_available_bonus - missing_penalty))

    return RecipeMatch(
        recipe=recipe,
        score=round(score, 4),
        used_required=used_required,
        missing_required=missing_required,
        optional_used=optional_used,
    )


def _sort_matches(match: RecipeMatch) -> tuple[float, int, int, int, int, str]:
    return (
        match.score,
        len(match.used_required),
        -len(match.missing_required),
        len(match.optional_used),
        -(match.recipe.prep_time_min + match.recipe.cook_time_min),
        match.recipe.title,
    )


def suggest_recipes_from_catalog(
    stock_items: Iterable[str | dict],
    *,
    limit: int = 5,
    catalog_path: str | os.PathLike[str] | None = None,
    meal_type: str | None = None,
    storage_focus: str | None = None,
) -> list[RecipeMatch]:
    recipes = get_recipes_catalog(
        catalog_path=catalog_path,
        meal_type=meal_type,
        storage_focus=storage_focus,
    )
    matches = [score_recipe_against_stock(recipe, stock_items) for recipe in recipes]
    matches.sort(key=_sort_matches, reverse=True)
    return matches[:limit]


def recipe_to_legacy_candidate(recipe: Recipe) -> dict:
    compat_focus = recipe.compat.storage_focus
    category = compat_focus[0] if compat_focus else (
        "frigo" if RecipeMealType.dinner in recipe.meal_type or RecipeMealType.lunch in recipe.meal_type else "placard"
    )
    return {
        "id": recipe.id,
        "title": recipe.title,
        "category": category,
        "ingredients": list(recipe.ingredients_required),
        "instructions_summary": recipe.summary,
        "prep_time_min": recipe.prep_time_min + recipe.cook_time_min,
        "difficulty": recipe.difficulty.value,
        "tags": list(recipe.tags),
        "meal_type": [mt.value for mt in recipe.meal_type],
        "cuisine": recipe.cuisine.value,
        "servings": recipe.servings,
    }


def recipe_match_to_suggestion(match: RecipeMatch) -> RecipeSuggestion:
    recipe = match.recipe
    return RecipeSuggestion(
        id=recipe.id,
        title=recipe.title,
        image="",
        usedIngredients=match.used_required,
        missedIngredients=match.missing_required,
        optionalIngredientsUsed=match.optional_used,
        sourceUrl="https://www.marmiton.org/recettes/recherche.aspx?aqt=" + recipe.title.replace(" ", "+"),
        is_fallback=not match.used_required,
        instructions_summary=recipe.summary,
        prep_time_min=recipe.prep_time_min,
        cook_time_min=recipe.cook_time_min,
        difficulty=recipe.difficulty,
        tags=recipe.tags,
        meal_type=recipe.meal_type,
        cuisine=recipe.cuisine,
        servings=recipe.servings,
        score=match.score,
    )


_FRENCH_RECIPE_DB: list[dict] = [recipe_to_legacy_candidate(recipe) for recipe in load_local_recipes()]


def _match_recipe_to_stock(
    recipe: dict,
    norm_stock: list[str],
    norm_urgent: set[str],
    boost_urgent: bool,
) -> tuple[float, list[str], list[str]]:
    """Compat legacy pour les routes existantes.

    Retourne (score, ingrédients_utilisés, ingrédients_manquants).
    """
    recipe_model = Recipe.model_validate({
        "id": recipe.get("id", "legacy_recipe"),
        "title": recipe.get("title", "Recette"),
        "summary": recipe.get("instructions_summary", ""),
        "ingredients_required": recipe.get("ingredients", []),
        "ingredients_optional": [],
        "steps": recipe.get("steps", ["Préparer la recette."]),
        "prep_time_min": int(recipe.get("prep_time_min", 0) or 0),
        "cook_time_min": int(recipe.get("cook_time_min", 0) or 0),
        "difficulty": recipe.get("difficulty", RecipeDifficulty.easy.value),
        "tags": recipe.get("tags", []),
        "meal_type": recipe.get("meal_type", [RecipeMealType.dinner.value]),
        "cuisine": recipe.get("cuisine", "française"),
        "servings": int(recipe.get("servings", 2) or 2),
    })
    match = score_recipe_against_stock(recipe_model, norm_stock)
    score = match.score
    if boost_urgent and any(
        _normalize_fr(used) in norm_urgent or any(nu in _normalize_fr(used) for nu in norm_urgent)
        for used in match.used_required
    ):
        score += 0.15
    return round(score, 4), match.used_required, match.missing_required
