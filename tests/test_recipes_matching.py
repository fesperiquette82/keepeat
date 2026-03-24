import sys
import json
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import Recipe
from recipes_service import (
    clear_recipe_catalog_cache,
    normalize_ingredient_text,
    score_recipe_against_stock,
    suggest_recipes_from_catalog,
)


class RecipeMatchingTests(unittest.TestCase):
    def _recipe(self, **overrides):
        payload = {
            "id": "fr_matching_recipe",
            "title": "Recette test",
            "summary": "Résumé",
            "ingredients_required": ["tomate", "fromage"],
            "ingredients_optional": ["basilic"],
            "steps": ["Assembler.", "Servir."],
            "prep_time_min": 5,
            "cook_time_min": 0,
            "difficulty": "easy",
            "tags": ["rapide"],
            "meal_type": ["lunch"],
            "cuisine": "française",
            "servings": 2,
        }
        payload.update(overrides)
        return Recipe.model_validate(payload)

    def test_normalize_ingredient_text_removes_accents_and_lowercases(self):
        self.assertEqual(normalize_ingredient_text("  Crème Fraîche "), "creme fraiche")

    def test_score_recipe_matches_synonyms(self):
        recipe = self._recipe(ingredients_required=["fromage"])
        match = score_recipe_against_stock(recipe, ["Gruyère râpé"])
        self.assertEqual(match.used_required, ["fromage"])
        self.assertEqual(match.missing_required, [])

    def test_complete_recipe_gets_bonus_over_partial_recipe(self):
        complete = self._recipe(id="fr_complete", title="Complete", ingredients_required=["tomate", "fromage"])
        partial = self._recipe(id="fr_partial", title="Partial", ingredients_required=["tomate", "fromage", "pain"])

        complete_match = score_recipe_against_stock(complete, ["tomates", "gruyere"])
        partial_match = score_recipe_against_stock(partial, ["tomates", "gruyere"])

        self.assertGreater(complete_match.score, partial_match.score)

    def test_suggest_recipes_from_catalog_sorts_best_match_first(self):
        matches = suggest_recipes_from_catalog(["oeufs", "beurre", "persil"], limit=3)
        self.assertGreaterEqual(len(matches), 1)
        self.assertEqual(matches[0].recipe.id, "fr_omelette_fines_herbes")
        self.assertEqual(matches[0].missing_required, [])

    def _build_catalog_recipe(self, recipe_id: str, title: str, required: list[str], **overrides) -> dict:
        payload = {
            "id": recipe_id,
            "title": title,
            "summary": "Résumé",
            "ingredients_required": required,
            "ingredients_optional": [],
            "steps": ["Assembler.", "Servir."],
            "prep_time_min": 10,
            "cook_time_min": 10,
            "difficulty": "easy",
            "tags": ["rapide", "familial"],
            "meal_type": ["dinner"],
            "cuisine": "française",
            "servings": 2,
        }
        payload.update(overrides)
        return payload

    def _suggest_from_temp_catalog(self, recipes: list[dict], stock: list[str], limit: int = 5):
        with tempfile.TemporaryDirectory() as tmpdir:
            catalog = Path(tmpdir) / "recipes.catalog.json"
            catalog.write_text(json.dumps(recipes, ensure_ascii=False), encoding="utf-8")
            clear_recipe_catalog_cache()
            return suggest_recipes_from_catalog(stock, limit=limit, catalog_path=catalog)

    def test_single_ultra_generic_ingredient_does_not_qualify_recipe(self):
        recipes = [self._build_catalog_recipe("ultra_only", "Eau salée", ["sel"])]
        matches = self._suggest_from_temp_catalog(recipes, ["sel"], limit=3)
        self.assertEqual(matches, [])

    def test_recipe_with_seventy_percent_required_coverage_is_suggested(self):
        required = ["poulet", "riz", "carotte", "oignon", "ail", "poivron", "courgette", "tomate", "fromage"]
        recipes = [self._build_catalog_recipe("coverage_70", "Poêlée complète", required)]
        stock = ["poulet", "riz", "carotte", "oignon", "ail", "poivron", "courgette"]
        matches = self._suggest_from_temp_catalog(recipes, stock, limit=3)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].recipe.id, "coverage_70")

    def test_recipe_with_too_many_missing_required_ingredients_is_excluded(self):
        required = ["poulet", "riz", "carotte", "oignon", "ail", "poivron"]
        recipes = [self._build_catalog_recipe("too_many_missing", "Poêlée incomplète", required)]
        stock = ["poulet", "riz"]
        matches = self._suggest_from_temp_catalog(recipes, stock, limit=3)
        self.assertEqual(matches, [])

    def test_simple_daily_recipes_rank_before_exotic_complex_ones(self):
        recipes = [
            self._build_catalog_recipe(
                "simple_omelette",
                "Omelette du quotidien",
                ["oeuf", "fromage"],
                difficulty="easy",
                prep_time_min=5,
                cook_time_min=5,
                tags=["rapide", "familial"],
            ),
            self._build_catalog_recipe(
                "exotic_complex",
                "Fusion exotique",
                ["oeuf", "fromage"],
                difficulty="hard",
                prep_time_min=40,
                cook_time_min=35,
                tags=["fete"],
            ),
        ]
        matches = self._suggest_from_temp_catalog(recipes, ["oeufs", "gruyere"], limit=3)
        self.assertEqual(len(matches), 2)
        self.assertEqual(matches[0].recipe.id, "simple_omelette")


if __name__ == "__main__":
    unittest.main()
