import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from observability import build_monitoring_kpis, classify_error_type, log_api_request, normalize_endpoint_key
from fastapi import HTTPException
from server import _is_admin_user, _require_admin_user


class _InsertOnlyCol:
    def __init__(self):
        self.items = []

    async def insert_one(self, payload):
        self.items.append(payload)


class _FakeUsersCol:
    def __init__(self, admin_doc=None):
        self.admin_doc = admin_doc

    async def count_documents(self, query):
        if query == {}:
            return 10
        if query == {"is_premium": True}:
            return 4
        if query == {"is_premium": True, "subscription_status": "active"}:
            return 3
        if query == {"store_product_id": "premium_monthly", "subscription_status": "active"}:
            return 2
        if query == {"is_premium": True, "subscription_status": "active", "store_product_id": {"$ne": "premium_monthly"}}:
            return 1
        return 2

    async def find_one(self, query, projection=None):
        _ = (query, projection)
        return self.admin_doc


class _FakeApiCol:
    async def count_documents(self, query):
        _ = query
        return 123

    async def distinct(self, field, query):
        _ = (field, query)
        return ["u1", "u2", "u3"]


class _FakeAggregateResult:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length):
        _ = length
        return list(self.rows)


class _FakeServiceCol:
    def aggregate(self, pipeline):
        _ = pipeline
        return _FakeAggregateResult([
            {"_id": "ocr", "units": 20, "cost": 1.5},
            {"_id": "ai_recipes", "units": 7, "cost": 0.9},
        ])


class ObservabilityTests(unittest.TestCase):
    def test_normalize_and_classify_error(self):
        self.assertEqual(normalize_endpoint_key("/api/stock/507f1f77bcf86cd799439011/consume"), "/api/stock/:id/consume")
        self.assertEqual(classify_error_type(status_code=422, path="/api/stock"), "validation_error")
        self.assertEqual(classify_error_type(status_code=401, path="/api/admin/monitoring/health"), "auth_error")

    def test_log_api_request_inserts_expected_shape(self):
        col = _InsertOnlyCol()

        async def _run():
            await log_api_request(
                api_request_logs_col=col,
                method="GET",
                path="/api/stock/507f1f77bcf86cd799439011",
                user_id="u-1",
                status_code=200,
                duration_ms=14.321,
            )

        asyncio.run(_run())
        self.assertEqual(len(col.items), 1)
        payload = col.items[0]
        self.assertEqual(payload["endpoint_key"], "/api/stock/:id")
        self.assertTrue(payload["success"])
        self.assertIsNone(payload["error_type"])

    def test_is_admin_user_with_flag_and_email_whitelist(self):
        self.assertTrue(_is_admin_user({"email": "admin@keepeat.app", "is_admin": True}))
        self.assertFalse(_is_admin_user({"email": "user@keepeat.app", "is_admin": False}))

    def test_require_admin_user_rejects_non_admin(self):
        class _Request:
            class _URL:
                path = "/api/admin/monitoring/health"

            url = _URL()

        async def _run():
            with patch("server.users_col", _FakeUsersCol(admin_doc={"email": "user@keepeat.app", "is_admin": False})):
                await _require_admin_user(
                    request=_Request(),
                    current_user={"id": "507f1f77bcf86cd799439011", "email": "user@keepeat.app"},
                )

        with self.assertRaises(HTTPException):
            asyncio.run(_run())

    def test_build_monitoring_kpis_core_fields(self):
        async def _run():
            return await build_monitoring_kpis(
                users_col=_FakeUsersCol(),
                api_request_logs_col=_FakeApiCol(),
                service_usage_logs_col=_FakeServiceCol(),
            )

        payload = asyncio.run(_run())
        self.assertEqual(payload["users"]["total"], 10)
        self.assertEqual(payload["users"]["premium"], 4)
        self.assertEqual(payload["subscriptions"]["active"], 3)
        self.assertEqual(payload["apis"]["volume_7d"], 123)
        self.assertGreaterEqual(len(payload["services"]["top_usage_30d"]), 1)


if __name__ == "__main__":
    unittest.main()
