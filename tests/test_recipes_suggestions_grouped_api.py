import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import Recipe
from recipes_service import score_recipe_against_stock
from server import get_recipe_suggestions_grouped


class _FakeAgg:
    def __init__(self, items):
        self._items = items

    async def to_list(self, length=20):
        return self._items[:length]


class _FakeStockCol:
    def __init__(self, items):
        self._items = items

    def aggregate(self, pipeline):
        return _FakeAgg(self._items)


class RecipeGroupedEndpointTests(unittest.TestCase):
    def _recipe(self, **overrides):
        payload = {
            "id": "fr_api_recipe",
            "title": "Recette API",
            "summary": "Résumé",
            "ingredients_required": ["oeuf", "fromage"],
            "ingredients_optional": ["basilic"],
            "steps": ["Assembler.", "Servir."],
            "prep_time_min": 10,
            "cook_time_min": 5,
            "difficulty": "easy",
            "tags": ["rapide"],
            "meal_type": ["dinner"],
            "cuisine": "française",
            "servings": 2,
        }
        payload.update(overrides)
        return Recipe.model_validate(payload)

    def test_grouped_endpoint_returns_expected_structure(self):
        ready = score_recipe_against_stock(self._recipe(id="r_ready", title="Ready", ingredients_required=["oeuf", "fromage"]), ["oeufs", "gruyere", "pain"])
        almost = score_recipe_against_stock(self._recipe(id="r_almost", title="Almost", ingredients_required=["oeuf", "fromage", "pain"]), ["oeufs", "gruyere"])
        inspiration = score_recipe_against_stock(
            self._recipe(id="r_inspiration", title="Inspiration", ingredients_required=["oeuf", "fromage", "pain", "jambon", "tomate", "oignon"]),
            ["oeufs", "gruyere", "pain"],
        )
        fake_groups = {"ready": [ready], "almost": [almost], "inspiration": [inspiration]}

        async def _run():
            with patch("server.stock_col", _FakeStockCol([{"name": "oeufs"}, {"name": "gruyere"}])):
                with patch("server.suggest_recipe_groups_from_catalog", return_value=fake_groups):
                    return await get_recipe_suggestions_grouped(
                        recipe_filter="all",
                        per_group_limit=5,
                        current_user={"id": "u1"},
                    )

        response = asyncio.run(_run())
        payload = response.model_dump(mode="json")

        self.assertEqual(set(payload.keys()), {"ready", "almost", "inspiration"})
        self.assertEqual(payload["ready"][0]["id"], "r_ready")
        self.assertEqual(payload["ready"][0]["match_status"], "ready")
        self.assertEqual(payload["almost"][0]["missing_required_count"], 1)
        self.assertEqual(payload["inspiration"][0]["match_status"], "inspiration")


if __name__ == "__main__":
    unittest.main()
