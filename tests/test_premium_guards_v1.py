import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

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


class PremiumGuardsV1Tests(unittest.TestCase):
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
            async def _empty_to_list(length=8):
                _ = length
                return []

            with patch("server.app_state_col", fake_state), patch.dict("os.environ", {"KEEPEAT_OPENAI_TOKEN": "x"}, clear=False), patch("server.stock_col") as stock_mock:
                stock_mock.find.return_value.sort.return_value.limit.return_value.to_list = _empty_to_list
                # 5 autorisés, 6e -> quota dépassé
                for _ in range(5):
                    await get_ai_recipes(current_user={"id": "u1", "is_premium": False})
                with self.assertRaises(HTTPException) as cm:
                    await get_ai_recipes(current_user={"id": "u1", "is_premium": False})
                self.assertEqual(cm.exception.status_code, 429)
                self.assertEqual(cm.exception.detail.get("code"), "QUOTA_EXCEEDED")

        asyncio.run(_run())

    def test_monthly_stats_clamped_to_six_for_free(self):
        async def _run():
            with patch("server.stock_col", _FakeStockCol()), patch("server.resolve_plan", return_value="free"):
                payload = await get_monthly_stats(months=24, current_user={"id": "u1", "is_premium": False})
                self.assertEqual(len(payload), 6)

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
