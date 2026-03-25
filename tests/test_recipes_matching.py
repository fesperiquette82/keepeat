import sys
import json
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import Recipe
from recipes_service import (
    clear_recipe_catalog_cache,
    classify_recipe_match,
    normalize_ingredient_text,
    score_recipe_against_stock,
    suggest_recipe_groups_from_catalog,
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


    def test_classify_recipe_match_ready_almost_inspiration(self):
        ready_match = score_recipe_against_stock(self._recipe(ingredients_required=["tomate"]), ["tomate"])
        almost_one_missing = score_recipe_against_stock(
            self._recipe(ingredients_required=["tomate", "fromage", "pain"]), ["tomate", "fromage"]
        )
        almost_two_missing = score_recipe_against_stock(
            self._recipe(ingredients_required=["tomate", "fromage", "pain", "jambon"]), ["tomate", "fromage"]
        )
        inspiration_match = score_recipe_against_stock(
            self._recipe(ingredients_required=["tomate", "fromage", "pain", "jambon", "oeuf", "lait"]),
            ["tomate", "fromage", "pain"],
        )

        self.assertEqual(classify_recipe_match(ready_match), "ready")
        self.assertEqual(classify_recipe_match(almost_one_missing), "almost")
        self.assertEqual(classify_recipe_match(almost_two_missing), "almost")
        self.assertEqual(classify_recipe_match(inspiration_match), "inspiration")

    def test_grouped_suggestions_respects_classification_threshold_and_order(self):
        recipes = [
            self._build_catalog_recipe("r_ready", "A Ready", ["fromage", "poulet"]),
            self._build_catalog_recipe("r_almost_one", "B Almost One", ["fromage", "poulet", "tomate", "jambon"]),
            self._build_catalog_recipe("r_almost_two", "C Almost Two", ["fromage", "poulet", "tomate", "pain", "oeuf", "lait"]),
            self._build_catalog_recipe(
                "r_inspiration",
                "D Inspiration",
                ["fromage", "poulet", "tomate", "pain", "oeuf", "lait", "farine"],
            ),
            self._build_catalog_recipe(
                "r_below_threshold",
                "Z Below",
                ["fromage", "poulet", "jambon", "oignon", "courgette", "riz", "ail"],
            ),
        ]
        stock = ["gruyere", "poulet", "tomates", "pain"]
        with tempfile.TemporaryDirectory() as tmpdir:
            catalog = Path(tmpdir) / "recipes.catalog.json"
            catalog.write_text(json.dumps(recipes, ensure_ascii=False), encoding="utf-8")
            clear_recipe_catalog_cache()
            grouped = suggest_recipe_groups_from_catalog(stock, limit_per_group=5, catalog_path=catalog)

        self.assertEqual([m.recipe.id for m in grouped["ready"]], ["r_ready"])
        self.assertEqual([m.recipe.id for m in grouped["almost"]], ["r_almost_one", "r_almost_two"])
        self.assertEqual([m.recipe.id for m in grouped["inspiration"]], [])
        all_ids = {m.recipe.id for group in grouped.values() for m in group}
        self.assertNotIn("r_below_threshold", all_ids)


    def test_grouped_suggestions_limit_per_group(self):
        recipes = [
            self._build_catalog_recipe("ready_1", "Ready 1", ["oeuf", "fromage"]),
            self._build_catalog_recipe("ready_2", "Ready 2", ["oeuf", "fromage"]),
            self._build_catalog_recipe("ready_3", "Ready 3", ["oeuf", "fromage"]),
        ]
        grouped = self._suggest_grouped_from_temp_catalog(recipes, ["oeufs", "gruyere"], limit_per_group=2)
        self.assertEqual(len(grouped["ready"]), 2)

    def _suggest_grouped_from_temp_catalog(self, recipes: list[dict], stock: list[str], limit_per_group: int = 5):
        with tempfile.TemporaryDirectory() as tmpdir:
            catalog = Path(tmpdir) / "recipes.catalog.json"
            catalog.write_text(json.dumps(recipes, ensure_ascii=False), encoding="utf-8")
            clear_recipe_catalog_cache()
            return suggest_recipe_groups_from_catalog(stock, limit_per_group=limit_per_group, catalog_path=catalog)


if __name__ == "__main__":
    unittest.main()
