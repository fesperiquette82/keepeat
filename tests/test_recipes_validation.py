import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from pydantic import ValidationError

from models import Recipe


class RecipeValidationTests(unittest.TestCase):
    def _base_recipe(self):
        return {
            "id": "fr_validation_omelette",
            "title": "Omelette validation",
            "summary": "Résumé",
            "ingredients_required": ["oeuf"],
            "ingredients_optional": ["persil"],
            "steps": ["Battre.", "Cuire."],
            "prep_time_min": 5,
            "cook_time_min": 3,
            "difficulty": "easy",
            "tags": ["rapide"],
            "meal_type": ["lunch"],
            "cuisine": "française",
            "servings": 2,
        }

    def test_recipe_requires_known_cuisine(self):
        payload = self._base_recipe()
        payload["cuisine"] = "francais"
        with self.assertRaises(ValidationError):
            Recipe.model_validate(payload)

    def test_recipe_requires_non_empty_required_ingredients(self):
        payload = self._base_recipe()
        payload["ingredients_required"] = []
        with self.assertRaises(ValidationError):
            Recipe.model_validate(payload)

    def test_recipe_requires_non_empty_steps(self):
        payload = self._base_recipe()
        payload["steps"] = []
        with self.assertRaises(ValidationError):
            Recipe.model_validate(payload)

    def test_recipe_requires_positive_servings(self):
        payload = self._base_recipe()
        payload["servings"] = 0
        with self.assertRaises(ValidationError):
            Recipe.model_validate(payload)

    def test_recipe_requires_known_meal_type(self):
        payload = self._base_recipe()
        payload["meal_type"] = ["brunch"]
        with self.assertRaises(ValidationError):
            Recipe.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
