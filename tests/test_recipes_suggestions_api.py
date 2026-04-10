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
                    response = Response()
                    payload = await get_recipe_suggestions(
                        response=response,
                        recipe_filter="day",
                        include_meta=True,
                        current_user={"id": "u1"},
                    )
                    return payload, response

        payload, response = asyncio.run(_run())
        self.assertEqual(payload["meta"]["returned"], 1)
        self.assertFalse(payload["meta"]["gap_logged"])
        self.assertEqual(payload["recipes"][0]["available_count"], 2)
        self.assertEqual(response.headers["X-Recipes-Filter"], "all")
        self.assertEqual(payload["meta"]["filter"], "day")
        self.assertEqual(payload["meta"]["filter_effective"], "all")

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
        self.assertEqual(mocked_gap.await_args.kwargs["uncovered_ingredients"], ["courgette"])
        self.assertIsNone(mocked_gap.await_args.kwargs["reference_recipe"])

    def test_legacy_filter_value_is_mapped_to_all(self):
        fake_recipes = _FakeCollection([])

        async def _run():
            with patch("server.recipes_col", fake_recipes):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[])) as mocked_stock:
                    with patch("server._upsert_recipe_gap", AsyncMock(return_value=False)):
                        response = Response()
                        await get_recipe_suggestions(
                            response=response,
                            recipe_filter="stock",
                            include_meta=True,
                            current_user={"id": "u1"},
                        )
                        return mocked_stock, response

        mocked_stock, response = asyncio.run(_run())
        self.assertEqual(mocked_stock.await_args.kwargs["filter_value"], "all")
        self.assertEqual(response.headers["X-Recipes-Filter"], "all")

    def test_gap_upsert_failure_does_not_break_response(self):
        fake_recipes = _FakeCollection([])
        fake_stock = [{"name": "courgette"}]

        async def _run():
            with patch("server.recipes_col", fake_recipes):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=fake_stock)):
                    with patch("server._upsert_recipe_gap", AsyncMock(side_effect=RuntimeError("db down"))):
                        return await get_recipe_suggestions(
                            response=Response(),
                            recipe_filter="all",
                            include_meta=True,
                            current_user={"id": "u1"},
                        )

        payload = asyncio.run(_run())
        self.assertEqual(payload["recipes"], [])
        self.assertTrue(payload["meta"]["suggest_later"])
        self.assertFalse(payload["meta"]["gap_logged"])

    def test_gap_transmet_les_non_couverts_par_recette_reference(self):
        fake_recipes = _FakeCollection(
            [
                {
                    "id": "recipe_ref",
                    "title": "Tomate mijotée",
                    "ingredients": [
                        {"name": "tomate", "optional": False},
                        {"name": "oignon", "optional": False},
                        {"name": "ail", "optional": False},
                        {"name": "sel", "optional": False},
                        {"name": "poivre", "optional": False},
                    ],
                    "steps": ["Cuire"],
                    "is_active": True,
                }
            ]
        )

        async def _run():
            with patch("server.recipes_col", fake_recipes):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "tomate"}, {"name": "courgette"}])):
                    with patch("server._upsert_recipe_gap", AsyncMock(return_value=True)) as mocked_gap:
                        await get_recipe_suggestions(
                            response=Response(),
                            recipe_filter="all",
                            include_meta=True,
                            current_user={"id": "u1"},
                        )
                        return mocked_gap

        mocked_gap = asyncio.run(_run())
        mocked_gap.assert_awaited_once()
        self.assertEqual(mocked_gap.await_args.kwargs["reference_recipe"]["id"], "recipe_ref")
        self.assertEqual(mocked_gap.await_args.kwargs["uncovered_ingredients"], ["courgette"])

    def test_include_meta_false_returns_recipe_list(self):
        fake_recipes = _FakeCollection(
            [
                {
                    "id": "recipe_basic",
                    "title": "Salade",
                    "ingredients": [{"name": "salade", "optional": False}],
                    "steps": ["Servir"],
                    "is_active": True,
                }
            ]
        )

        async def _run():
            with patch("server.recipes_col", fake_recipes):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "salade"}])):
                    return await get_recipe_suggestions(
                        response=Response(),
                        recipe_filter="all",
                        include_meta=False,
                        current_user={"id": "u1"},
                    )

        payload = asyncio.run(_run())
        self.assertIsInstance(payload, list)
        self.assertEqual(payload[0]["id"], "recipe_basic")


if __name__ == "__main__":
    unittest.main()
