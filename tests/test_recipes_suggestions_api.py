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
from server import get_recipe_suggestions


class _FakeAgg:
    def __init__(self, items):
        self._items = items

    async def to_list(self, length=1000):
        return self._items[:length]


class _FakeCursor:
    def __init__(self, items):
        self._items = items

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, length):
        self._items = self._items[:length]
        return self

    async def to_list(self, length=1000):
        return self._items[:length]


class _FakeStockCol:
    def __init__(self, aggregate_items, find_items):
        self._aggregate_items = aggregate_items
        self._find_items = find_items

    def aggregate(self, _pipeline):
        return _FakeAgg(self._aggregate_items)

    def find(self, *_args, **_kwargs):
        return _FakeCursor(self._find_items)


class RecipeSuggestionsEndpointTests(unittest.TestCase):
    def _recipe(self, **overrides):
        payload = {
            "id": "fr_api_recipe",
            "title": "Recette API",
            "summary": "Résumé",
            "ingredients_required": ["oeuf", "fromage"],
            "ingredients_optional": [],
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

    def test_constrained_filter_is_completed_with_all_stock_fallback(self):
        urgent_only = [
            score_recipe_against_stock(self._recipe(id="urgent_1", title="Urgent 1"), ["oeufs", "gruyere"]),
        ]
        all_stock_pool = [
            score_recipe_against_stock(self._recipe(id="all_1", title="All 1"), ["oeufs", "gruyere"]),
            score_recipe_against_stock(self._recipe(id="all_2", title="All 2"), ["oeufs", "gruyere"]),
            score_recipe_against_stock(self._recipe(id="all_3", title="All 3"), ["oeufs", "gruyere"]),
        ]

        fake_stock = _FakeStockCol(
            aggregate_items=[{"name": "oeufs"}],
            find_items=[{"name": "oeufs"}, {"name": "gruyere"}],
        )

        async def _run():
            with patch("server.stock_col", fake_stock):
                with patch("server.suggest_recipes_from_catalog", side_effect=[urgent_only, all_stock_pool]):
                    return await get_recipe_suggestions(
                        recipe_filter="urgent",
                        current_user={"id": "u1"},
                    )

        response = asyncio.run(_run())
        ids = [r["id"] for r in response]

        self.assertIn("urgent_1", ids)
        self.assertIn("all_1", ids)
        self.assertIn("all_2", ids)


if __name__ == "__main__":
    unittest.main()
