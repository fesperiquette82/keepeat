"""Tests de non-régression — BUG-045 / BUG-046 (audit commercial, point 07).

Constat : le catalogue local ne comptait que 53 recettes. Le repli IA
(Gemini, déclenché automatiquement quand aucune recette du catalogue ne
couvre le stock) devenait donc le cas courant plutôt que l'exception — coût,
latence et consommation de quota à chaque bascule. Le catalogue est étendu
en deux temps jusqu'à 303 recettes (53 existantes + 72 générées par lot puis
relues + 96 rédigées directement + 82 rédigées directement lors d'une
seconde passe de complétion), toutes validées contre le même schéma
Pydantic (Recipe) que celui utilisé en production.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from recipes_service import clear_recipe_catalog_cache, load_local_recipes  # noqa: E402


def setup_function(_fn):
    clear_recipe_catalog_cache()


def teardown_function(_fn):
    clear_recipe_catalog_cache()


def test_catalog_has_at_least_300_recipes():
    recipes = load_local_recipes()
    assert len(recipes) >= 300


def test_catalog_recipe_ids_are_unique():
    recipes = load_local_recipes()
    ids = [r.id for r in recipes]
    assert len(ids) == len(set(ids))


def test_catalog_recipe_titles_are_unique():
    recipes = load_local_recipes()
    titles = [r.title for r in recipes]
    assert len(titles) == len(set(titles))


def test_all_catalog_recipes_load_without_validation_error():
    # load_local_recipes() lève RecipeCatalogError au premier échec de
    # validation Pydantic (cf. Recipe.model_validate dans recipes_service.py) —
    # ce test échoue donc déjà si un seul enregistrement est invalide.
    recipes = load_local_recipes()
    assert all(r.id for r in recipes)
    assert all(r.ingredients_required for r in recipes)
    assert all(r.steps for r in recipes)
