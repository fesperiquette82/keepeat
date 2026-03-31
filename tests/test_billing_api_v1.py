import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import BillingVerifyRequest
from server import get_billing_entitlements, get_billing_usage, restore_subscription, verify_google_subscription


class _FakeUpdateResult:
    matched_count = 1


class _FakeUsersCol:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, query, projection=None):
        _ = (query, projection)
        return dict(self.doc)

    async def update_one(self, query, update, upsert=False):
        _ = (query, upsert)
        set_data = update.get("$set", {})
        self.doc.update(set_data)
        return _FakeUpdateResult()


class _FakeAppStateCol:
    def __init__(self, counters=None):
        self.counters = counters or {}

    async def find_one(self, query, projection=None):
        _ = projection
        return self.counters.get(query.get("_id"))


class BillingApiV1Tests(unittest.TestCase):
    user_id = "507f1f77bcf86cd799439011"

    def test_get_entitlements_for_free_user(self):
        fake_users = _FakeUsersCol({"_id": self.user_id, "is_premium": False, "subscription_status": "inactive"})

        async def _run():
            with patch("server.users_col", fake_users):
                return await get_billing_entitlements(current_user={"id": self.user_id, "is_premium": False})

        payload = asyncio.run(_run())
        self.assertEqual(payload.plan, "free")
        self.assertFalse(payload.is_premium)

    def test_get_usage_returns_remaining(self):
        counter_id = f"usage:{self.user_id}:ocr_receipt:2026-03"
        fake_users = _FakeUsersCol({"_id": self.user_id, "is_premium": False, "subscription_status": "inactive"})
        fake_state = _FakeAppStateCol(counters={counter_id: {"used": 3}})

        async def _run():
            with patch("server.users_col", fake_users), patch("server.app_state_col", fake_state), patch("server._current_period_key", return_value="2026-03"):
                return await get_billing_usage(current_user={"id": self.user_id, "is_premium": False})

        payload = asyncio.run(_run())
        self.assertEqual(payload.period, "2026-03")
        self.assertEqual(payload.usage["ocr_receipt"].used, 3)
        self.assertEqual(payload.usage["ocr_receipt"].remaining, 7)

    def test_verify_sets_premium(self):
        fake_users = _FakeUsersCol({"_id": self.user_id, "is_premium": False, "subscription_status": "inactive"})

        async def _run():
            with patch("server.users_col", fake_users):
                body = BillingVerifyRequest(platform="android", product_id="premium_monthly", purchase_token="tok_1")
                return await verify_google_subscription(body=body, current_user={"id": self.user_id})

        payload = asyncio.run(_run())
        self.assertTrue(payload.ok)
        self.assertEqual(payload.plan, "premium")
        self.assertEqual(fake_users.doc.get("subscription_status"), "active")

    def test_restore_returns_free_when_expired(self):
        fake_users = _FakeUsersCol({
            "_id": self.user_id,
            "is_premium": True,
            "subscription_status": "active",
            "subscription_expires_at": "2020-01-01T00:00:00+00:00",
        })

        async def _run():
            with patch("server.users_col", fake_users):
                return await restore_subscription(current_user={"id": self.user_id})

        payload = asyncio.run(_run())
        self.assertTrue(payload.ok)
        self.assertEqual(payload.plan, "free")


if __name__ == "__main__":
    unittest.main()
