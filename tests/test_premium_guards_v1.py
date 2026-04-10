import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import server
from fastapi import HTTPException

from server import get_ai_recipes, get_monthly_stats, get_predictions, ocr_receipt_route


class _FakeAppStateCol:
    def __init__(self):
        self.data = {}

    async def find_one_and_update(self, query, update, upsert=False, return_document=None):
        _ = (upsert, return_document)
        key = query["_id"]
        doc = self.data.setdefault(key, {"_id": key, "used": 0})
        doc["used"] += int(update.get("$inc", {}).get("used", 0))
        return doc


class _FakeAgg:
    async def to_list(self, length=1):
        _ = length
        return []


class _FakeStockCol:
    def aggregate(self, pipeline):
        _ = pipeline
        return _FakeAgg()


class _FakeOpenAiResponse:
    def __init__(self, status_code=200, content='[{"title":"Omelette","ingredients_used":["oeufs"],"instructions_summary":"Cuire.","prep_time_min":10}]'):
        self.status_code = status_code
        self._content = content
        self.text = content

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        _ = (exc_type, exc, tb)
        return False

    async def post(self, *_args, **_kwargs):
        return self._response


class PremiumGuardsV1Tests(unittest.TestCase):
    def setUp(self):
        server._ai_recipe_cache.clear()

    def _total_quota_used(self, fake_state):
        return sum(int(entry.get("used", 0)) for entry in fake_state.data.values())

    def test_predictions_is_premium_only(self):
        async def _run():
            with self.assertRaises(HTTPException) as cm:
                await get_predictions(current_user={"id": "u1", "is_premium": False})
            self.assertEqual(cm.exception.status_code, 403)
            self.assertEqual(cm.exception.detail.get("code"), "PREMIUM_REQUIRED")

        asyncio.run(_run())

    def test_ocr_quota_exceeded_returns_standard_error(self):
        fake_state = _FakeAppStateCol()

        async def _run():
            async def _fake_ocr(request, current_user):
                _ = (request, current_user)
                return []

            with patch("server.app_state_col", fake_state), patch("server.ocr_receipt", side_effect=_fake_ocr):
                await ocr_receipt_route(request=None, current_user={"id": "u1", "is_premium": False})
                with self.assertRaises(HTTPException) as cm:
                    # quota free OCR = 10 ; on force rapidement en bouclant
                    for _ in range(11):
                        await ocr_receipt_route(request=None, current_user={"id": "u1", "is_premium": False})
                self.assertEqual(cm.exception.status_code, 429)
                self.assertEqual(cm.exception.detail.get("code"), "QUOTA_EXCEEDED")

        asyncio.run(_run())

    def test_ai_quota_exceeded_returns_standard_error(self):
        fake_state = _FakeAppStateCol()

        async def _run():
            async def _stock_to_list(length=8):
                _ = length
                return [{"name": "oeufs", "food_category": "proteines"}]

            with patch("server.app_state_col", fake_state), patch.dict("os.environ", {"GEMINI_RECIPES_API_KEY": "x"}, clear=False), patch("server.stock_col") as stock_mock, patch("server.httpx.AsyncClient", return_value=_FakeAsyncClient(_FakeOpenAiResponse())), patch("server.track_service_usage"), patch("server.track_business_event"):
                stock_mock.find.return_value.sort.return_value.limit.return_value.to_list = _stock_to_list
                for _ in range(5):
                    server._ai_recipe_cache.clear()
                    await get_ai_recipes(current_user={"id": "u1", "is_premium": False})
                server._ai_recipe_cache.clear()
                with self.assertRaises(HTTPException) as cm:
                    await get_ai_recipes(current_user={"id": "u1", "is_premium": False})
                self.assertEqual(cm.exception.status_code, 429)
                self.assertEqual(cm.exception.detail.get("code"), "QUOTA_EXCEEDED")

        asyncio.run(_run())

    def test_ai_empty_stock_does_not_consume_quota(self):
        fake_state = _FakeAppStateCol()

        async def _run():
            async def _stock_to_list(length=8):
                _ = length
                return []

            with patch("server.app_state_col", fake_state), patch.dict("os.environ", {"GEMINI_RECIPES_API_KEY": "x"}, clear=False), patch("server.stock_col") as stock_mock:
                stock_mock.find.return_value.sort.return_value.limit.return_value.to_list = _stock_to_list
                payload = await get_ai_recipes(current_user={"id": "u1", "is_premium": False})
                self.assertEqual(payload, [])
                self.assertEqual(self._total_quota_used(fake_state), 0)

        asyncio.run(_run())

    def test_ai_openai_error_does_not_consume_quota(self):
        fake_state = _FakeAppStateCol()

        async def _run():
            async def _stock_to_list(length=8):
                _ = length
                return [{"name": "oeufs", "food_category": "proteines"}]

            with patch("server.app_state_col", fake_state), patch.dict("os.environ", {"GEMINI_RECIPES_API_KEY": "x"}, clear=False), patch("server.stock_col") as stock_mock, patch("server.httpx.AsyncClient", return_value=_FakeAsyncClient(_FakeOpenAiResponse(status_code=500, content="boom"))), patch("server.track_service_usage"), patch("server.track_business_event"):
                stock_mock.find.return_value.sort.return_value.limit.return_value.to_list = _stock_to_list
                with self.assertRaises(HTTPException) as cm:
                    await get_ai_recipes(current_user={"id": "u1", "is_premium": False})
                self.assertEqual(cm.exception.status_code, 502)
                self.assertEqual(self._total_quota_used(fake_state), 0)

        asyncio.run(_run())

    def test_monthly_stats_clamped_to_six_for_free(self):
        async def _run():
            with patch("server.stock_col", _FakeStockCol()), patch("server.resolve_plan", return_value="free"):
                payload = await get_monthly_stats(months=24, current_user={"id": "u1", "is_premium": False})
                self.assertEqual(len(payload), 6)

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
