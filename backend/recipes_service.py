from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import threading
import unicodedata as _ud
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Literal

import httpx
from pydantic import ValidationError

from backend.app_core import logger
from backend.models import Recipe, RecipeDifficulty, RecipeGroupedSuggestion, RecipeMealType, RecipeSuggestion, RecipeSuggestionIngredient

_FRIGO_CATS = ["frais", "proteines", "legumes", "boissons"]
_PLACARD_CATS = ["feculents", "desserts", "epicerie", "autres"]

_DEFAULT_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "recipes.catalog.json"
_catalog_write_lock = threading.Lock()
_MIN_SCORE_MAIN_SUGGESTION = 0.55
_MIN_SCORE_NEAR_SUGGESTION = 0.35
_DEFAULT_GEMINI_RECIPES_MODEL = "gemini-2.0-flash-lite"
_DEPRECATED_GEMINI_RECIPES_MODELS: frozenset[str] = frozenset({"gemini-1.5-flash"})
_ULTRA_GENERIC_INGREDIENTS = {
    "sel", "salt", "poivre", "pepper", "eau", "water", "huile", "oil", "olive oil",
}
WEAK_INGREDIENTS = {
    "oeuf", "oeufs", "egg", "eggs",
    "lait", "milk",
    "sucre", "sugar",
    "farine", "flour",
    "sel", "salt",
    "huile", "oil",
    "beurre", "butter",
}
_DAILY_FRENCH_TAGS = {"rapide", "familial", "economique", "anti-gaspi", "batch cooking"}
_FAMILIAR_DEFAULT_LOCALE = "fr-FR"
_FAMILIAR_CUISINES = {"francaise", "francais", "europeenne", "mediterraneenne"}
_EXOTIC_MARKERS = {
    "thai", "thailand", "japon", "japonaise", "ramen", "sushi", "teriyaki",
    "indien", "indienne", "curry", "masala", "mexicain", "mexicaine", "tacos",
    "kebab", "libanais", "coreen", "kimchi", "wok", "pho", "bo bun", "pad thai",
}

_RECIPE_TEXT_FIELDS = ("title", "summary")
_RECIPE_LIST_TEXT_FIELDS = ("steps", "tags", "search_terms")
_FRENCH_TEXT_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\boeufs\b", re.IGNORECASE), "œufs"),
    (re.compile(r"\boeuf\b", re.IGNORECASE), "œuf"),
    (re.compile(r"\bcremeuse\b", re.IGNORECASE), "crémeuse"),
    (re.compile(r"\bcremeux\b", re.IGNORECASE), "crémeux"),
    (re.compile(r"\bcreme\b", re.IGNORECASE), "crème"),
    (re.compile(r"\bdejeuner\b", re.IGNORECASE), "déjeuner"),
    (re.compile(r"\bgouter\b", re.IGNORECASE), "goûter"),
    (re.compile(r"\bmelanger\b", re.IGNORECASE), "mélanger"),
    (re.compile(r"\bpate\b", re.IGNORECASE), "pâte"),
    (re.compile(r"\bcuillere\b", re.IGNORECASE), "cuillère"),
    (re.compile(r"\bleger\b", re.IGNORECASE), "léger"),
    (re.compile(r"\bideal\b", re.IGNORECASE), "idéal"),
    (re.compile(r"\bbouchees\b", re.IGNORECASE), "bouchées"),
    (re.compile(r"\brafraichir\b", re.IGNORECASE), "rafraîchir"),
    (re.compile(r"\bmaizena\b", re.IGNORECASE), "maïzena"),
    (re.compile(r"(?<=\s)a(?=\s|['’])"), "à"),
)

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
    suggestion_type: Literal["perfect", "near", "idea"] = "perfect"
    familiarity_score: float = 0.0
    familiarity_reason: str = ""
    ranking_reason: str = ""


class RecipeCatalogError(RuntimeError):
    """Raised when the local recipe catalog cannot be loaded or validated."""


def _autocorrect_recipe_text(value: str) -> str:
    corrected = value

    def _replace(match: re.Match[str], replacement: str) -> str:
        token = match.group(0)
        if token.isupper():
            return replacement.upper()
        if token[:1].isupper():
            return replacement[:1].upper() + replacement[1:]
        return replacement

    for pattern, replacement in _FRENCH_TEXT_REPLACEMENTS:
        corrected = pattern.sub(lambda m, r=replacement: _replace(m, r), corrected)
    return corrected


def _autocorrect_recipe_payload(item: dict[str, Any]) -> dict[str, Any]:
    corrected = dict(item)

    for field in _RECIPE_TEXT_FIELDS:
        raw = corrected.get(field)
        if isinstance(raw, str):
            corrected[field] = _autocorrect_recipe_text(raw)

    for field in _RECIPE_LIST_TEXT_FIELDS:
        raw = corrected.get(field)
        if isinstance(raw, list):
            corrected[field] = [_autocorrect_recipe_text(entry) if isinstance(entry, str) else entry for entry in raw]

    return corrected


def fr_to_en_ingredient(name: str, category: str = "autres") -> str:
    """Convertit un nom de produit français en ingrédient anglais (pour les alertes quotidiennes)."""
    norm = _normalize_fr(name)
    for fr_word in sorted(_FR_EN, key=len, reverse=True):
        if _normalize_fr(fr_word) in norm:
            return _FR_EN[fr_word]
    return _CATEGORY_TO_EN.get(category, "chicken")


_RECIPE_AI_RETRY_ATTEMPTS = 3
_RECIPE_AI_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


def _extract_gemini_recipe_text(payload: Any) -> str | None:
    """Extrait le texte d'une réponse Gemini de façon défensive.

    Retourne None (au lieu de lever KeyError/IndexError) si la réponse est vide,
    bloquée (promptFeedback.blockReason) ou de structure inattendue (cf. E3).
    """
    if not isinstance(payload, dict):
        return None
    block_reason = (payload.get("promptFeedback") or {}).get("blockReason")
    if block_reason:
        logger.warning("Gemini suggest recipe blocked: %s", block_reason)
        return None
    candidates = payload.get("candidates") or []
    if not candidates:
        return None
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    for part in parts:
        text = (part or {}).get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    return None


async def _generate_ai_recipe(stock_names: list[str], gemini_key: str) -> dict | None:
    """Appelle Gemini pour générer 1 recette française depuis les ingrédients du stock.
    Retourne None en cas d'échec ou si GEMINI_RECIPES_API_KEY n'est pas configuré.

    Résilience (cf. E3) : retry avec backoff sur erreurs transitoires (429/5xx) et
    parsing défensif de la réponse (réponse vide / bloquée → None, pas de crash).
    """
    prompt = _AI_SUGGEST_PROMPT.format(ingredients="\n".join(f"- {n}" for n in stock_names))
    model = os.environ.get("GEMINI_RECIPES_MODEL", "").strip()
    if model.startswith("models/"):
        model = model.split("models/", 1)[1].strip()
    if not model or model in _DEPRECATED_GEMINI_RECIPES_MODELS:
        model = _DEFAULT_GEMINI_RECIPES_MODEL
    text: str | None = None
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            for attempt in range(1, _RECIPE_AI_RETRY_ATTEMPTS + 1):
                r = await http.post(
                    # Clé en header x-goog-api-key (jamais en query-string) — cf. E2.
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    headers={"Content-Type": "application/json", "x-goog-api-key": gemini_key},
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "maxOutputTokens": 350,
                            "responseMimeType": "application/json",
                        },
                    },
                )
                if r.status_code == 200:
                    text = _extract_gemini_recipe_text(r.json())
                    break
                if r.status_code in _RECIPE_AI_RETRYABLE_STATUSES and attempt < _RECIPE_AI_RETRY_ATTEMPTS:
                    logger.warning(
                        "Gemini suggest recipe transient %s model=%s attempt=%d/%d, retry",
                        r.status_code, model, attempt, _RECIPE_AI_RETRY_ATTEMPTS,
                    )
                    await asyncio.sleep(float(2 ** attempt))
                    continue
                logger.warning("Gemini suggest recipe error %s model=%s: %s", r.status_code, model, r.text[:200])
                return None
    except Exception as exc:
        logger.warning("Gemini suggest recipe failed: %s", exc)
        return None

    if not text:
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
            logger.warning("Gemini suggest recipe invalid structure: %s", text[:200])
            return None
        return data
    except Exception:
        logger.warning("Gemini suggest recipe invalid JSON: %s", text[:200])
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
        if isinstance(item, dict):
            item = _autocorrect_recipe_payload(item)
        try:
            recipe = Recipe.model_validate(item)
        except ValidationError as exc:
            raise RecipeCatalogError(f"Invalid recipe at index {index}: {exc}") from exc
        if recipe.id in seen_ids:
            raise RecipeCatalogError(f"Duplicate recipe id detected: {recipe.id}")
        seen_ids.add(recipe.id)
        recipes.append(recipe)

    return tuple(recipes)




def get_recipe_catalog_debug_info() -> dict[str, str]:
    """Return stable metadata for the currently loaded local catalog."""
    recipes = load_local_recipes()
    payload = [recipe.model_dump(mode="json") for recipe in recipes]
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "recipes_source": str(_DEFAULT_CATALOG_PATH),
        "catalog_hash": digest[:16],
        "catalog_name": _DEFAULT_CATALOG_PATH.name,
        "catalog_locale": "fr-FR",
    }

def clear_recipe_catalog_cache() -> None:
    load_local_recipes.cache_clear()


def append_recipe_to_catalog(recipe_dict: dict, catalog_path: str | os.PathLike[str] | None = None) -> None:
    """Ajoute une nouvelle recette au fichier JSON du catalogue et invalide le cache mémoire."""
    path = Path(catalog_path) if catalog_path else _DEFAULT_CATALOG_PATH
    with _catalog_write_lock:
        try:
            raw: list = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise RecipeCatalogError(f"Impossible de lire le catalogue pour l'ajout : {exc}") from exc
        raw.append(recipe_dict)
        try:
            path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            raise RecipeCatalogError(f"Impossible d'écrire le catalogue après ajout : {exc}") from exc
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


def _ingredient_strength(ingredient: str) -> str:
    terms = _candidate_terms(ingredient)
    if terms & _ULTRA_GENERIC_INGREDIENTS:
        return "ultra"
    if terms & WEAK_INGREDIENTS:
        return "weak"
    return "strong"


def _required_coverage_gate(required_total: int) -> float:
    if required_total <= 2:
        return 1.0
    if required_total <= 4:
        return 0.6
    return 0.5


def _compute_score(match: RecipeMatch) -> float:
    required_total = len(match.used_required) + len(match.missing_required)
    required_coverage = (len(match.used_required) / required_total) if required_total else 0.0
    optional_total = len(match.recipe.ingredients_optional)
    optional_coverage = (len(match.optional_used) / optional_total) if optional_total else 0.0
    missing_required_ratio = (len(match.missing_required) / required_total) if required_total else 1.0
    required_strengths = {ingredient: _ingredient_strength(ingredient) for ingredient in match.recipe.ingredients_required}
    used_strong_count = sum(1 for ingredient in match.used_required if required_strengths.get(ingredient) == "strong")
    used_weak_or_ultra_count = len(match.used_required) - used_strong_count
    score = (
        0.75 * required_coverage
        + 0.08 * min(1.0, used_strong_count / 3)
        - 0.12 * min(1.0, used_weak_or_ultra_count / 2)
        + 0.2 * optional_coverage
        - 0.55 * missing_required_ratio
    )
    if used_strong_count >= 2:
        score += 0.08
    if len(match.used_required) >= 3:
        score += 0.04
    if match.recipe.difficulty == RecipeDifficulty.easy:
        score += 0.1
    if (match.recipe.prep_time_min + match.recipe.cook_time_min) < 40:
        score += 0.05
    return round(max(0.0, min(1.0, score)), 4)


def _resolve_ranking_reason(match: RecipeMatch) -> str:
    required_total = len(match.used_required) + len(match.missing_required)
    required_strengths = {ingredient: _ingredient_strength(ingredient) for ingredient in match.recipe.ingredients_required}
    used_strong_count = sum(1 for ingredient in match.used_required if required_strengths.get(ingredient) == "strong")

    if not match.used_required:
        return "no_match_required_ingredients"
    if used_strong_count == 0:
        return "only_generic_matches"
    missing_ratio = (len(match.missing_required) / required_total) if required_total else 1.0
    if missing_ratio >= 0.5:
        return "too_many_missing_ingredients"
    if used_strong_count >= 2 and len(match.missing_required) == 0:
        return "strong_multi_ingredient_match"
    if len(match.used_required) >= 3:
        return "good_multi_ingredient_coverage"
    return "partial_but_acceptable_match"


def _compute_familiarity(match: RecipeMatch, *, locale: str = _FAMILIAR_DEFAULT_LOCALE) -> tuple[float, str]:
    recipe = match.recipe
    ingredients_blob = " ".join(recipe.ingredients_required + recipe.ingredients_optional)
    signals = " ".join(
        [
            recipe.title,
            ingredients_blob,
            " ".join(recipe.tags),
            " ".join(recipe.search_terms),
            recipe.source.type,
            recipe.source.name,
            recipe.cuisine.value,
        ]
    )
    normalized_signals = _normalize_fr(signals)
    normalized_cuisine = _normalize_fr(recipe.cuisine.value)

    exotic_hits = sorted(marker for marker in _EXOTIC_MARKERS if marker in normalized_signals)
    daily_tag_hits = sorted(tag for tag in _DAILY_FRENCH_TAGS if _normalize_fr(tag) in normalized_signals)

    score = 0.45
    reasons = [f"locale={locale}"]
    if normalized_cuisine in _FAMILIAR_CUISINES:
        score += 0.3
        reasons.append("cuisine_familiar")
    if daily_tag_hits:
        score += min(0.15, 0.05 * len(daily_tag_hits))
        reasons.append(f"daily_tags={','.join(daily_tag_hits)}")
    if _normalize_fr(recipe.source.type) == "local_catalog":
        score += 0.05
        reasons.append("source_local_catalog")
    if exotic_hits:
        penalty = 0.55 if len(exotic_hits) >= 2 else 0.35
        score -= penalty
        reasons.append(f"exotic_markers={','.join(exotic_hits)}")

    return round(max(0.0, min(1.0, score)), 4), "|".join(reasons)


def _evaluate_recipe_eligibility(match: RecipeMatch, *, relaxed: bool = False) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    required_strengths = {ingredient: _ingredient_strength(ingredient) for ingredient in match.recipe.ingredients_required}
    used_strong = [ingredient for ingredient in match.used_required if required_strengths.get(ingredient) == "strong"]
    used_weak_or_ultra = [
        ingredient for ingredient in match.used_required if required_strengths.get(ingredient) in {"weak", "ultra"}
    ]
    required_total = len(match.recipe.ingredients_required)
    used_required_count = len(match.used_required)
    high_coverage_daily_exception = (
        not used_strong
        and required_total > 0
        and required_total <= 4
        and used_required_count >= 3
        and (used_required_count / required_total) >= 0.75
    )

    if not match.used_required:
        reasons.append("no_required_match")
    min_strong_needed = 1 if relaxed else 2
    if len(used_strong) < min_strong_needed and not high_coverage_daily_exception:
        reasons.append(f"strong_matches_below_{min_strong_needed}")
    if used_weak_or_ultra and not used_strong and not high_coverage_daily_exception:
        reasons.append("only_weak_or_ultra_matches")
    return (len(reasons) == 0), reasons


def is_recipe_eligible(match: RecipeMatch) -> bool:
    eligible, _ = _evaluate_recipe_eligibility(match, relaxed=False)
    return eligible


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

    match = RecipeMatch(
        recipe=recipe,
        score=0.0,
        used_required=used_required,
        missing_required=missing_required,
        optional_used=optional_used,
    )
    match.score = _compute_score(match)
    match.ranking_reason = _resolve_ranking_reason(match)
    return match


def _sort_matches(match: RecipeMatch, *, suggestion_style: SuggestionStyle = "classique") -> tuple[float, float, float, int, int, int, int, int, str]:
    difficulty_rank = {
        RecipeDifficulty.easy: 3,
        RecipeDifficulty.medium: 2,
        RecipeDifficulty.hard: 1,
    }
    rank_score = _compute_rank_score(match, suggestion_style=suggestion_style)
    return (
        rank_score,
        match.familiarity_score,
        match.score,
        len(match.used_required),
        -len(match.missing_required),
        difficulty_rank.get(match.recipe.difficulty, 0),
        len(match.optional_used),
        -(match.recipe.prep_time_min + match.recipe.cook_time_min),
        match.recipe.title,
    )


def _compute_rank_score(match: RecipeMatch, *, suggestion_style: SuggestionStyle = "classique") -> float:
    familiarity_weight = {
        "classique": 0.55,
        "ouvert": 0.30,
        "toutes_cuisines": 0.0,
    }[suggestion_style]
    return round(match.score + (familiarity_weight * match.familiarity_score), 4)




def _ranked_matches_from_catalog(
    stock_items: Iterable[str | dict],
    *,
    catalog_path: str | os.PathLike[str] | None = None,
    meal_type: str | None = None,
    storage_focus: str | None = None,
    suggestion_style: str | None = None,
    allow_world_cuisines: bool | None = None,
) -> list[RecipeMatch]:
    resolved_style = _normalize_suggestion_style(suggestion_style, allow_world_cuisines)
    raw_stock = normalize_stock_items(stock_items)
    normalized_stock = [_normalize_fr(item) for item in raw_stock]
    logger.debug(
        "RECIPES_DEBUG scoring input — meal_type=%s storage_focus=%s raw_stock=%s normalized_stock=%s",
        meal_type,
        storage_focus,
        raw_stock,
        normalized_stock,
    )
    recipes = get_recipes_catalog(
        catalog_path=catalog_path,
        meal_type=meal_type,
        storage_focus=storage_focus,
    )
    scored_matches = [score_recipe_against_stock(recipe, raw_stock) for recipe in recipes]
    for match in scored_matches:
        match.familiarity_score, match.familiarity_reason = _compute_familiarity(match)
    pre_sorted_matches = sorted(
        scored_matches,
        key=lambda match: _sort_matches(match, suggestion_style=resolved_style),
        reverse=True,
    )
    logger.debug(
        "RECIPES_DEBUG scoring top10_pre_threshold=%s",
        [
            {
                "title": m.recipe.title,
                "score": m.score,
                "final_rank_score": _compute_rank_score(m, suggestion_style=resolved_style),
                "familiarity_score": m.familiarity_score,
                "familiarity_reason": m.familiarity_reason,
                "matchedIngredients": m.used_required,
                "missingIngredients": m.missing_required,
                "ranking_reason": m.ranking_reason,
            }
            for m in pre_sorted_matches[:10]
        ],
    )
    strict_matches: list[RecipeMatch] = []
    rejected_reasons: list[dict[str, str | float | list[str]]] = []
    for match in pre_sorted_matches:
        eligible, reasons = _evaluate_recipe_eligibility(match, relaxed=False)
        if not eligible:
            rejected_reasons.append(
                {
                    "title": match.recipe.title,
                    "score": match.score,
                    "final_rank_score": _compute_rank_score(match, suggestion_style=resolved_style),
                    "reasons": reasons,
                    "ranking_reason": match.ranking_reason,
                }
            )
            continue
        if match.score < _MIN_SCORE_MAIN_SUGGESTION:
            rejected_reasons.append(
                {
                    "title": match.recipe.title,
                    "score": match.score,
                    "final_rank_score": _compute_rank_score(match, suggestion_style=resolved_style),
                    "reasons": ["below_min_score"],
                    "ranking_reason": match.ranking_reason,
                }
            )
            continue
        familiarity_gate = 0.35 if resolved_style == "classique" else (0.2 if resolved_style == "ouvert" else 0.0)
        if familiarity_gate > 0 and match.familiarity_score < familiarity_gate:
            rejected_reasons.append(
                {
                    "title": match.recipe.title,
                    "score": match.score,
                    "final_rank_score": _compute_rank_score(match, suggestion_style=resolved_style),
                    "reasons": [f"low_familiarity:{match.familiarity_reason}"],
                    "ranking_reason": match.ranking_reason,
                }
            )
            continue
        strict_matches.append(match)

    matches = strict_matches
    if len(matches) < 3:
        relaxed_candidates: list[RecipeMatch] = []
        for match in pre_sorted_matches:
            if match in strict_matches:
                continue
            eligible, reasons = _evaluate_recipe_eligibility(match, relaxed=True)
            if not eligible or not match.used_required:
                continue
            if match.score < 0.35:
                continue
            relaxed_candidates.append(match)
            logger.debug(
                "RECIPES_DEBUG relaxed_candidate title=%s score=%.4f missing_required=%s reasons=%s",
                match.recipe.title,
                match.score,
                match.missing_required,
                reasons,
            )
        matches = strict_matches + relaxed_candidates

    matches.sort(
        key=lambda match: _sort_matches(match, suggestion_style=resolved_style),
        reverse=True,
    )
    logger.debug(
        "RECIPES_DEBUG scoring summary total=%d strict_kept=%d final_kept=%d rejected=%d",
        len(scored_matches),
        len(strict_matches),
        len(matches),
        len(rejected_reasons),
    )
    logger.debug(
        "RECIPES_DEBUG scoring rejected_top10=%s",
        rejected_reasons[:10],
    )
    logger.debug(
        "RECIPES_DEBUG scoring top10_post_threshold=%s min_score=%.2f",
        [
            {
                "title": m.recipe.title,
                "score": m.score,
                "final_rank_score": _compute_rank_score(m, suggestion_style=resolved_style),
                "familiarity_score": m.familiarity_score,
                "familiarity_reason": m.familiarity_reason,
                "matchedIngredients": m.used_required,
                "missingIngredients": m.missing_required,
                "ranking_reason": m.ranking_reason,
            }
            for m in matches[:10]
        ],
        _MIN_SCORE_MAIN_SUGGESTION,
    )
    logger.debug(
        "RECIPES_DEBUG scoring top5_scores=%s",
        [{"title": m.recipe.title, "score": m.score} for m in matches[:5]],
    )
    return matches

def suggest_recipes_from_catalog(
    stock_items: Iterable[str | dict],
    *,
    limit: int = 5,
    catalog_path: str | os.PathLike[str] | None = None,
    meal_type: str | None = None,
    storage_focus: str | None = None,
    suggestion_style: str | None = None,
    allow_world_cuisines: bool | None = None,
) -> list[RecipeMatch]:
    resolved_style = _normalize_suggestion_style(suggestion_style, allow_world_cuisines)
    raw_stock = normalize_stock_items(stock_items)
    recipes = get_recipes_catalog(
        catalog_path=catalog_path,
        meal_type=meal_type,
        storage_focus=storage_focus,
    )
    scored_matches = [score_recipe_against_stock(recipe, raw_stock) for recipe in recipes]
    for match in scored_matches:
        match.familiarity_score, match.familiarity_reason = _compute_familiarity(match)
    scored_matches = sorted(
        scored_matches,
        key=lambda match: _sort_matches(match, suggestion_style=resolved_style),
        reverse=True,
    )

    perfect_matches: list[RecipeMatch] = []
    near_matches: list[RecipeMatch] = []
    idea_matches: list[RecipeMatch] = []
    simple_idea_meal_types = {
        RecipeMealType.breakfast,
        RecipeMealType.snack,
        RecipeMealType.dessert,
        RecipeMealType.aperitif,
    }

    familiarity_gate = 0.35 if resolved_style == "classique" else (0.2 if resolved_style == "ouvert" else 0.0)
    for match in scored_matches:
        if not match.used_required:
            continue

        required_total = len(match.used_required) + len(match.missing_required)
        eligible_strict, _ = _evaluate_recipe_eligibility(match, relaxed=False)
        eligible_relaxed, _ = _evaluate_recipe_eligibility(match, relaxed=True)

        if (
            match.score >= _MIN_SCORE_MAIN_SUGGESTION
            and (eligible_strict or (eligible_relaxed and len(match.missing_required) == 0))
            and (familiarity_gate == 0.0 or match.familiarity_score >= familiarity_gate)
        ):
            match.suggestion_type = "perfect"
            perfect_matches.append(match)
            continue

        if (
            eligible_relaxed
            and 1 <= len(match.missing_required) <= 2
            and match.score >= _MIN_SCORE_NEAR_SUGGESTION
        ):
            match.suggestion_type = "near"
            near_matches.append(match)
            continue

        if (
            any(mt in simple_idea_meal_types for mt in match.recipe.meal_type)
            and required_total > 0
            and len(match.missing_required) <= max(2, required_total - 1)
        ):
            match.suggestion_type = "idea"
            idea_matches.append(match)

    merged = perfect_matches + near_matches + idea_matches
    return merged[:limit]




RecipeMatchGroup = Literal["ready", "almost", "inspiration"]
SuggestionStyle = Literal["classique", "ouvert", "toutes_cuisines"]


def _normalize_suggestion_style(
    suggestion_style: str | Any | None,
    allow_world_cuisines: bool | None = None,
) -> SuggestionStyle:
    if allow_world_cuisines is True:
        return "toutes_cuisines"
    raw_style = suggestion_style if isinstance(suggestion_style, str) else None
    style = _normalize_fr(raw_style or "classique").replace(" ", "_")
    if style in {"ouvert", "open"}:
        return "ouvert"
    if style in {"toutes_cuisines", "toutes", "world", "all_cuisines"}:
        return "toutes_cuisines"
    return "classique"


def resolve_suggestion_style(
    suggestion_style: str | None,
    allow_world_cuisines: bool | None = None,
) -> SuggestionStyle:
    """Public helper used by API layer to expose the resolved style in debug/meta."""
    return _normalize_suggestion_style(suggestion_style, allow_world_cuisines)


def classify_recipe_match(match: RecipeMatch) -> RecipeMatchGroup:
    missing_required_count = len(match.missing_required)
    if missing_required_count == 0:
        return "ready"
    if missing_required_count <= 2:
        return "almost"
    return "inspiration"


def suggest_recipe_groups_from_catalog(
    stock_items: Iterable[str | dict],
    *,
    limit_per_group: int = 5,
    catalog_path: str | os.PathLike[str] | None = None,
    meal_type: str | None = None,
    storage_focus: str | None = None,
    suggestion_style: str | None = None,
    allow_world_cuisines: bool | None = None,
) -> dict[RecipeMatchGroup, list[RecipeMatch]]:
    matches = _ranked_matches_from_catalog(
        stock_items,
        catalog_path=catalog_path,
        meal_type=meal_type,
        storage_focus=storage_focus,
        suggestion_style=suggestion_style,
        allow_world_cuisines=allow_world_cuisines,
    )

    grouped: dict[RecipeMatchGroup, list[RecipeMatch]] = {
        "ready": [],
        "almost": [],
        "inspiration": [],
    }
    for match in matches:
        status = classify_recipe_match(match)
        if len(grouped[status]) >= limit_per_group:
            continue
        grouped[status].append(match)
    return grouped

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
    structured_ingredients = [
        RecipeSuggestionIngredient(
            name=ingredient,
            quantity=None,
            unit=None,
            display_label="Quantité à ajuster",
            optional=False,
            available=ingredient in match.used_required,
            matched_stock_item_ids=[],
            missing_quantity=None if ingredient in match.used_required else None,
            is_estimated=True,
        )
        for ingredient in recipe.ingredients_required
    ]
    return RecipeSuggestion(
        id=recipe.id,
        title=recipe.title,
        summary=recipe.summary,
        image="",
        usedIngredients=match.used_required,
        missedIngredients=match.missing_required,
        optionalIngredientsUsed=match.optional_used,
        ingredients=structured_ingredients,
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
        suggestion_type=match.suggestion_type,
        used_ingredients_count=len(match.used_required),
        missing_ingredients_count=len(match.missing_required),
        debug={
            "matchedIngredients": list(match.used_required),
            "missingIngredients": list(match.missing_required),
            "final_score": _compute_rank_score(match),
            "ranking_reason": match.ranking_reason,
            "familiarity_score": match.familiarity_score,
            "familiarity_reason": match.familiarity_reason,
        },
    )



def recipe_match_to_grouped_suggestion(match: RecipeMatch) -> RecipeGroupedSuggestion:
    recipe = match.recipe
    status = classify_recipe_match(match)
    return RecipeGroupedSuggestion(
        id=recipe.id,
        title=recipe.title,
        used_ingredients=match.used_required,
        missing_ingredients=match.missing_required,
        optional_ingredients_used=match.optional_used,
        score=match.score,
        prep_time_min=recipe.prep_time_min,
        cook_time_min=recipe.cook_time_min,
        difficulty=recipe.difficulty,
        tags=recipe.tags,
        meal_type=recipe.meal_type,
        cuisine=recipe.cuisine,
        servings=recipe.servings,
        match_status=status,
        matched_required_count=len(match.used_required),
        missing_required_count=len(match.missing_required),
    )


try:
    _FRENCH_RECIPE_DB: list[dict] = [recipe_to_legacy_candidate(recipe) for recipe in load_local_recipes()]
except Exception as _catalog_load_exc:
    import logging as _logging
    _logging.getLogger("keepeat-backend").warning(
        "Catalogue de recettes non chargé au démarrage : %s — les suggestions de recettes seront désactivées.",
        _catalog_load_exc,
    )
    _FRENCH_RECIPE_DB = []


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
