import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import Recipe
from recipes_service import normalize_ingredient_text, score_recipe_against_stock, suggest_recipes_from_catalog


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


if __name__ == "__main__":
    unittest.main()
