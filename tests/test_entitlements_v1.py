import asyncio
import unittest
from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from entitlements import (
    FEATURE_AI,
    FEATURE_OCR,
    FEATURE_PREDICTIONS,
    FREE_PLAN,
    PREMIUM_PLAN,
    check_access_or_raise,
    consume_quota_or_raise,
    feature_policy,
    resolve_plan,
)


class _FakeAppStateCol:
    def __init__(self):
        self.data = {}

    async def find_one_and_update(self, query, update, upsert=False, return_document=None):
        _ = (upsert, return_document)
        key = query["_id"]
        doc = self.data.setdefault(key, {"_id": key, "used": 0})
        doc["used"] = int(doc.get("used", 0)) + int(update.get("$inc", {}).get("used", 0))
        self.data[key] = doc
        return doc


class EntitlementsV1Tests(unittest.TestCase):
    def test_resolve_plan_free_by_default(self):
        self.assertEqual(resolve_plan({}), FREE_PLAN)

    def test_resolve_plan_premium_when_active_and_not_expired(self):
        user = {
            "subscription_status": "active",
            "subscription_expires_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
        }
        self.assertEqual(resolve_plan(user), PREMIUM_PLAN)

    def test_resolve_plan_downgrades_when_expired(self):
        user = {
            "is_premium": True,
            "subscription_status": "active",
            "subscription_expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        }
        self.assertEqual(resolve_plan(user), FREE_PLAN)

    def test_feature_policy_free_and_premium(self):
        free_predictions = feature_policy(FREE_PLAN, FEATURE_PREDICTIONS)
        self.assertFalse(free_predictions["allowed"])

        premium_predictions = feature_policy(PREMIUM_PLAN, FEATURE_PREDICTIONS)
        self.assertTrue(premium_predictions["allowed"])

    def test_check_access_raises_premium_required(self):
        with self.assertRaises(HTTPException) as cm:
            check_access_or_raise(plan=FREE_PLAN, feature=FEATURE_PREDICTIONS)
        self.assertEqual(cm.exception.status_code, 403)
        self.assertEqual(cm.exception.detail.get("code"), "PREMIUM_REQUIRED")

    def test_consume_quota_raises_when_exceeded(self):
        async def _run():
            col = _FakeAppStateCol()
            await consume_quota_or_raise(
                app_state_col=col,
                user_id="u1",
                feature=FEATURE_OCR,
                monthly_limit=1,
                period="2026-03",
                reset_at="2026-04-01T00:00:00Z",
            )
            with self.assertRaises(HTTPException) as cm:
                await consume_quota_or_raise(
                    app_state_col=col,
                    user_id="u1",
                    feature=FEATURE_OCR,
                    monthly_limit=1,
                    period="2026-03",
                    reset_at="2026-04-01T00:00:00Z",
                )
            self.assertEqual(cm.exception.status_code, 429)
            self.assertEqual(cm.exception.detail.get("code"), "QUOTA_EXCEEDED")

        asyncio.run(_run())

    def test_consume_quota_passes_below_limit(self):
        async def _run():
            col = _FakeAppStateCol()
            result = await consume_quota_or_raise(
                app_state_col=col,
                user_id="u1",
                feature=FEATURE_AI,
                monthly_limit=3,
                period="2026-03",
                reset_at="2026-04-01T00:00:00Z",
            )
            self.assertEqual(result["used"], 1)
            self.assertEqual(result["remaining"], 2)

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
