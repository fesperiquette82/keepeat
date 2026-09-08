import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from backend.google_play_billing import VerificationOutcome
from models import BillingVerifyRequest
from server import get_billing_entitlements, get_billing_usage, restore_subscription, verify_google_subscription


class _FakeUpdateResult:
    matched_count = 1


class _FakeUsersCol:
    """Fake honorant les filtres réellement utilisés par le code testé.

    `find_one` ignorait auparavant la requête et renvoyait toujours le document,
    ce qui rendait indétectable un filtre incorrect — et faisait passer pour
    « déjà rattaché » la recherche d'unicité de jeton d'achat (BUG-062).
    `other_docs` permet de simuler d'autres comptes."""

    def __init__(self, doc, other_docs=None):
        self.doc = doc
        self.other_docs = list(other_docs or [])

    def _matches(self, candidate, query):
        for key, expected in query.items():
            actual = candidate.get(key)
            if isinstance(expected, dict) and "$ne" in expected:
                if actual == expected["$ne"]:
                    return False
                continue
            if actual != expected:
                return False
        return True

    async def find_one(self, query, projection=None):
        _ = projection
        for candidate in [self.doc, *self.other_docs]:
            if self._matches(candidate, query):
                return dict(candidate)
        return None

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
        self.assertEqual(payload.usage["ocr_receipt"].remaining, 5)

    def _verify(self, fake_users, outcome, play_data=None, env=None):
        async def _fake_verify(purchase_token, subscription_id):
            _ = (purchase_token, subscription_id)
            return outcome, play_data

        async def _run():
            with patch("server.users_col", fake_users), patch(
                "server._verify_google_play_subscription", _fake_verify
            ), patch.dict(os.environ, env or {}, clear=False):
                body = BillingVerifyRequest(
                    platform="android", product_id="premium_monthly", purchase_token="tok_1"
                )
                return await verify_google_subscription(body=body, current_user={"id": self.user_id})

        return asyncio.run(_run())

    def _fresh_user(self, **extra):
        return _FakeUsersCol(
            {"_id": self.user_id, "is_premium": False, "subscription_status": "inactive", **extra}
        )

    def test_verify_sets_premium_when_google_confirms(self):
        fake_users = self._fresh_user()
        payload = self._verify(
            fake_users,
            VerificationOutcome.VERIFIED,
            {"paymentState": 1, "expiryTimeMillis": "1790000000000"},
        )
        self.assertTrue(payload.ok)
        self.assertEqual(payload.plan, "premium")
        self.assertEqual(fake_users.doc.get("subscription_status"), "active")

    def test_verification_unavailable_never_grants_premium(self):
        """[REGRESSION] BUG-062 — une panne de vérification (réseau, 5xx,
        credentials) accordait 30 jours de Premium gratuits."""
        fake_users = self._fresh_user()
        with self.assertRaises(HTTPException) as ctx:
            self._verify(fake_users, VerificationOutcome.UNAVAILABLE)
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.detail["code"], "VERIFICATION_UNAVAILABLE")
        self.assertFalse(fake_users.doc.get("is_premium"))
        self.assertEqual(fake_users.doc.get("subscription_status"), "inactive")
        # La demande est mémorisée pour une revérification ultérieure.
        self.assertEqual(fake_users.doc.get("pending_purchase_token"), "tok_1")

    def test_google_rejection_never_grants_premium(self):
        """[REGRESSION] BUG-062 — un HTTP 400 de Google donnait quand même Premium."""
        fake_users = self._fresh_user()
        with self.assertRaises(HTTPException) as ctx:
            self._verify(fake_users, VerificationOutcome.INVALID)
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertEqual(ctx.exception.detail["code"], "PURCHASE_REJECTED")
        self.assertFalse(fake_users.doc.get("is_premium"))

    def test_missing_service_account_blocks_in_production(self):
        """[REGRESSION] BUG-062 — `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` absent
        valait « offrir 30 jours » ; il vaut désormais « je ne sais pas »."""
        fake_users = self._fresh_user()
        with self.assertRaises(HTTPException) as ctx:
            self._verify(
                fake_users,
                VerificationOutcome.NOT_CONFIGURED,
                env={"ALLOW_UNVERIFIED_PURCHASES": "", "APP_ENV": "production"},
            )
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertFalse(fake_users.doc.get("is_premium"))

    def test_missing_service_account_grants_only_with_explicit_dev_flag(self):
        fake_users = self._fresh_user()
        payload = self._verify(
            fake_users,
            VerificationOutcome.NOT_CONFIGURED,
            env={"ALLOW_UNVERIFIED_PURCHASES": "true", "APP_ENV": "production"},
        )
        self.assertEqual(payload.plan, "premium")

    def test_payment_not_received_is_refused(self):
        fake_users = self._fresh_user()
        with self.assertRaises(HTTPException) as ctx:
            self._verify(fake_users, VerificationOutcome.VERIFIED, {"paymentState": 0})
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertFalse(fake_users.doc.get("is_premium"))

    def test_purchase_token_already_linked_to_another_account(self):
        """[REGRESSION] BUG-062 — un même jeton pouvait créditer plusieurs comptes."""
        fake_users = _FakeUsersCol(
            {"_id": self.user_id, "is_premium": False, "subscription_status": "inactive"},
            other_docs=[{"_id": "507f1f77bcf86cd799439099", "store_purchase_token": "tok_1"}],
        )
        with self.assertRaises(HTTPException) as ctx:
            self._verify(fake_users, VerificationOutcome.VERIFIED, {"paymentState": 1})
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["code"], "PURCHASE_TOKEN_ALREADY_LINKED")
        self.assertFalse(fake_users.doc.get("is_premium"))

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
