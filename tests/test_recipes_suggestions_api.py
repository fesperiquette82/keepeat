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
import server
from server import get_recipe_suggestions
from starlette.responses import Response


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

    def test_include_meta_exposes_requested_and_effective_locale(self):
        fake_stock = _FakeStockCol(
            aggregate_items=[{"name": "oeufs"}, {"name": "gruyere"}],
            find_items=[{"name": "oeufs"}, {"name": "gruyere"}],
        )
        matches = [
            score_recipe_against_stock(self._recipe(id="locale_1", title="Locale 1"), ["oeufs", "gruyere"]),
        ]

        async def _run():
            with patch("server.stock_col", fake_stock):
                with patch("server.suggest_recipes_from_catalog", return_value=matches):
                    response = Response()
                    payload = await get_recipe_suggestions(
                        response=response,
                        recipe_filter="all",
                        include_meta=True,
                        locale=None,
                        accept_language="en-US,en;q=0.9",
                        current_user={"id": "u1"},
                    )
                    return payload, response

        payload, response = asyncio.run(_run())
        meta = payload["meta"]
        self.assertEqual(meta["requested_locale"], "en-US")
        self.assertEqual(meta["effective_locale"], "fr-FR")
        self.assertEqual(response.headers.get("X-Requested-Locale"), "en-US")
        self.assertEqual(response.headers.get("X-Effective-Locale"), "fr-FR")

    def test_personalized_filter_is_mapped_and_prunes_low_accessible_matches(self):
        fake_stock = _FakeStockCol(
            aggregate_items=[{"name": "oeufs"}, {"name": "gruyere"}],
            find_items=[{"name": "oeufs"}, {"name": "gruyere"}],
        )
        perfect = score_recipe_against_stock(self._recipe(id="pf1", title="Perfect"), ["oeufs", "gruyere"])
        perfect.suggestion_type = "perfect"
        near = score_recipe_against_stock(
            self._recipe(id="nr1", title="Near", ingredients_required=["oeuf", "fromage", "pain"]),
            ["oeufs", "gruyere"],
        )
        near.suggestion_type = "near"
        low_idea = score_recipe_against_stock(
            self._recipe(id="id1", title="Low idea", ingredients_required=["oeuf", "fromage", "pain", "lait", "tomate", "oignon"]),
            ["oeufs", "gruyere"],
        )
        low_idea.suggestion_type = "idea"
        low_idea.score = 0.2

        async def _run():
            with patch("server.stock_col", fake_stock):
                with patch("server.suggest_recipes_from_catalog", return_value=[perfect, near, low_idea]):
                    response = Response()
                    payload = await get_recipe_suggestions(
                        response=response,
                        recipe_filter="personalized",
                        include_meta=True,
                        current_user={"id": "u1"},
                    )
                    return payload, response

        payload, response = asyncio.run(_run())
        ids = [r["id"] for r in payload["recipes"]]

        self.assertIn("pf1", ids)
        self.assertIn("nr1", ids)
        self.assertNotIn("id1", ids)
        self.assertEqual(payload["meta"]["filter"], "personalized")
        self.assertEqual(payload["meta"]["filter_effective"], "all")
        self.assertEqual(response.headers.get("X-Recipes-Filter"), "all")

    def test_suggestion_style_is_forwarded_and_exposed_in_headers(self):
        fake_stock = _FakeStockCol(
            aggregate_items=[{"name": "oeufs"}, {"name": "gruyere"}],
            find_items=[{"name": "oeufs"}, {"name": "gruyere"}],
        )
        matches = [score_recipe_against_stock(self._recipe(id="style_1", title="Style 1"), ["oeufs", "gruyere"])]

        async def _run():
            with patch("server.stock_col", fake_stock):
                with patch("server.suggest_recipes_from_catalog", return_value=matches) as mocked:
                    response = Response()
                    payload = await get_recipe_suggestions(
                        response=response,
                        recipe_filter="all",
                        suggestion_style="open",
                        include_meta=True,
                        current_user={"id": "u1"},
                    )
                    return payload, response, mocked

        payload, response, mocked = asyncio.run(_run())
        self.assertEqual(payload["meta"]["suggestion_style"], "ouvert")
        self.assertEqual(response.headers.get("X-Recipes-Suggestion-Style"), "ouvert")
        self.assertEqual(mocked.call_args.kwargs.get("suggestion_style"), "ouvert")

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
