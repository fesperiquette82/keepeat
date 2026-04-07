import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from server import get_recipe_suggestions
from starlette.responses import Response


class _FakeCursor:
    def __init__(self, items):
        self._items = items

    async def to_list(self, length=1000):
        return self._items[:length]


class _FakeCollection:
    def __init__(self, items):
        self._items = items

    def find(self, *_args, **_kwargs):
        return _FakeCursor(self._items)


class RecipeSuggestionsEndpointTests(unittest.TestCase):
    def test_returns_ranked_recipes_and_meta_payload(self):
        fake_recipes = _FakeCollection(
            [
                {
                    "id": "recipe_urgent",
                    "title": "Poêlée courgette oeuf",
                    "description": "Simple",
                    "dish_type": "Poêlée",
                    "duration_min": 12,
                    "ingredients": [{"name": "courgette", "optional": False}, {"name": "oeuf", "optional": False}],
                    "steps": ["Cuire"],
                    "is_active": True,
                }
            ]
        )
        fake_stock = [
            {"name": "courgette"},
            {"name": "oeufs"},
        ]

        async def _run():
            with patch("server.recipes_col", fake_recipes):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=fake_stock)):
                    return await get_recipe_suggestions(
                        response=Response(),
                        recipe_filter="day",
                        include_meta=True,
                        current_user={"id": "u1"},
                    )

        payload = asyncio.run(_run())
        self.assertEqual(payload["meta"]["returned"], 1)
        self.assertFalse(payload["meta"]["gap_logged"])
        self.assertEqual(payload["recipes"][0]["available_count"], 2)

    def test_gap_is_logged_when_no_recipe_is_relevant(self):
        fake_recipes = _FakeCollection(
            [
                {
                    "id": "recipe_missing",
                    "title": "Soupe tomate",
                    "ingredients": [{"name": "tomate", "optional": False}, {"name": "oignon", "optional": False}],
                    "steps": ["Cuire"],
                    "is_active": True,
                }
            ]
        )
        fake_stock = [{"name": "courgette"}]

        async def _run():
            with patch("server.recipes_col", fake_recipes):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=fake_stock)):
                    with patch("server._upsert_recipe_gap", AsyncMock(return_value=True)) as mocked_gap:
                        payload = await get_recipe_suggestions(
                            response=Response(),
                            recipe_filter="week",
                            include_meta=True,
                            current_user={"id": "u1"},
                        )
                        return payload, mocked_gap

        payload, mocked_gap = asyncio.run(_run())
        self.assertEqual(payload["recipes"], [])
        self.assertTrue(payload["meta"]["gap_logged"])
        mocked_gap.assert_awaited_once()

    def test_legacy_filter_value_is_mapped_to_all(self):
        fake_recipes = _FakeCollection([])

        async def _run():
            with patch("server.recipes_col", fake_recipes):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[])) as mocked_stock:
                    with patch("server._upsert_recipe_gap", AsyncMock(return_value=False)):
                        await get_recipe_suggestions(
                            response=Response(),
                            recipe_filter="stock",
                            include_meta=True,
                            current_user={"id": "u1"},
                        )
                        return mocked_stock

        mocked_stock = asyncio.run(_run())
        self.assertEqual(mocked_stock.await_args.kwargs["filter_value"], "all")

    def test_non_premium_keeps_existing_flow_without_gpt_call(self):
        fake_stock = _FakeStockCol(
            aggregate_items=[{"name": "oeufs"}, {"name": "gruyere"}],
            find_items=[{"name": "oeufs"}, {"name": "gruyere"}],
        )
        matches = [score_recipe_against_stock(self._recipe(id="np_1", title="Sans GPT"), ["oeufs", "gruyere"])]

        async def _run():
            with patch("server.stock_col", fake_stock):
                with patch("server.suggest_recipes_from_catalog", return_value=matches):
                    with patch("server._fetch_gpt_recipes") as gpt_mock:
                        response = Response()
                        payload = await get_recipe_suggestions(
                            response=response,
                            recipe_filter="all",
                            include_meta=True,
                            current_user={"id": "u1", "is_premium": False},
                        )
                        return payload, gpt_mock

        payload, gpt_mock = asyncio.run(_run())
        self.assertFalse(gpt_mock.called)
        self.assertEqual(len(payload["recipes"]), 1)
        self.assertFalse(payload["meta"]["premium_ai_enabled"])
        self.assertFalse(payload["meta"]["ai_used"])
        self.assertEqual(payload["meta"]["ai_recipe_count"], 0)

    def test_premium_enriches_suggestions_with_gpt_recipes(self):
        fake_stock = _FakeStockCol(
            aggregate_items=[{"name": "oeufs", "expiry_date": "2030-01-01", "food_category": "proteines"}],
            find_items=[{"name": "oeufs"}],
        )
        matches = [score_recipe_against_stock(self._recipe(id="pm_1", title="Base"), ["oeufs", "gruyere"])]
        gpt_payload = [
            server._GptRecipePayload(
                title="Poêlée anti-gaspi aux œufs",
                description="Rapide et simple.",
                duration_min=12,
                dish_type="Poêlée",
                available_ingredients=["œufs"],
                missing_ingredients=["oignon"],
                steps=["Battre les œufs.", "Cuire rapidement."],
                anti_waste_reason="Utilise les œufs proches de la date.",
            )
        ]

        async def _run():
            with patch("server.stock_col", fake_stock):
                with patch("server.suggest_recipes_from_catalog", return_value=matches):
                    with patch("server._fetch_gpt_recipes", return_value=gpt_payload):
                        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test", "OPENAI_MODEL": "gpt-4o-mini"}, clear=False):
                            response = Response()
                            return await get_recipe_suggestions(
                                response=response,
                                recipe_filter="expiryWeek",
                                include_meta=True,
                                current_user={"id": "u1", "is_premium": True, "subscription_status": "active"},
                            )

        payload = asyncio.run(_run())
        titles = [recipe["title"] for recipe in payload["recipes"]]
        self.assertIn("Poêlée anti-gaspi aux œufs", titles)
        self.assertTrue(payload["meta"]["premium_ai_enabled"])
        self.assertTrue(payload["meta"]["ai_used"])
        self.assertEqual(payload["meta"]["ai_recipe_count"], 1)


if __name__ == "__main__":
    unittest.main()
