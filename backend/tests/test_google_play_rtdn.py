"""Non-régression BUG-063 — webhook RTDN Google Play.

Couvre l'endpoint lui-même (authentification, effets sur les droits, reprise
sur erreur), là où `test_google_play_billing.py` couvre la logique de décision.
"""

import asyncio
import base64
import json
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

import importlib

from fastapi import HTTPException

from backend.google_play_billing import VerificationOutcome


def _server():
    """Résout `backend.server` au moment de l'appel, jamais à l'import.

    D'autres suites (test_admin_monitoring.py) suppriment `backend.server` de
    `sys.modules` puis le réimportent pour le recharger avec un environnement
    différent. Une référence capturée à l'import pointerait alors sur l'ANCIEN
    module : les patches s'appliqueraient au nouveau tandis que la fonction
    testée lirait les globales de l'ancien — le vrai Mongo et la vraie
    vérification Google seraient utilisés, et le test échouerait uniquement
    quand la suite complète tourne (ce qu'un fichier lancé seul ne montre pas).
    """
    return importlib.import_module("backend.server")


class _FakeUpdateResult:
    matched_count = 1


class _FakeUsersCol:
    def __init__(self, doc=None):
        self.doc = doc if doc is not None else {}
        self.updates: list[dict] = []

    async def find_one(self, query, projection=None):
        _ = (query, projection)
        return dict(self.doc) if self.doc else None

    async def update_one(self, query, update, upsert=False):
        _ = (query, upsert)
        set_data = update.get("$set", {})
        self.updates.append(set_data)
        self.doc.update(set_data)
        return _FakeUpdateResult()


class _FakeRequest:
    def __init__(self, payload, auth_header=""):
        self._payload = payload
        self.headers = {"Authorization": auth_header} if auth_header else {}

    async def json(self):
        return self._payload


def _rtdn_payload(notification_type, purchase_token="tok_rtdn"):
    inner = {
        "subscriptionNotification": {
            "notificationType": notification_type,
            "purchaseToken": purchase_token,
            "subscriptionId": "premium_monthly",
        }
    }
    return {"message": {"data": base64.b64encode(json.dumps(inner).encode()).decode()}}


_TOKEN = "rtdn-secret"


def _run_rtdn(payload, *, users_col, auth=f"Bearer {_TOKEN}", token_env=_TOKEN, verify=None):
    async def _default_verify(purchase_token, subscription_id):
        _ = (purchase_token, subscription_id)
        return VerificationOutcome.VERIFIED, {"expiryTimeMillis": "1790000000000"}

    async def _run():
        server = _server()
        env = {"GOOGLE_RTDN_TOKEN": token_env} if token_env is not None else {}
        with patch.dict(os.environ, env, clear=False), patch.object(
            server, "users_col", users_col
        ), patch.object(server, "_verify_google_play_subscription", verify or _default_verify):
            if token_env is None:
                os.environ.pop("GOOGLE_RTDN_TOKEN", None)
            return await server.google_play_rtdn(_FakeRequest(payload, auth))

    return asyncio.run(_run())


class RtdnAuthenticationTests(unittest.TestCase):
    def test_missing_secret_refuses_instead_of_accepting_anonymously(self):
        """[REGRESSION] BUG-063 — sans GOOGLE_RTDN_TOKEN, la route acceptait
        n'importe quelle requête et laissait quiconque couper/activer le Premium."""
        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn", "is_premium": True})
        with self.assertRaises(HTTPException) as ctx:
            _run_rtdn(_rtdn_payload(13), users_col=users, auth="", token_env=None)
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(users.updates, [])

    def test_wrong_token_is_rejected(self):
        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn"})
        with self.assertRaises(HTTPException) as ctx:
            _run_rtdn(_rtdn_payload(13), users_col=users, auth="Bearer wrong")
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(users.updates, [])


class RtdnEntitlementEffectTests(unittest.TestCase):
    def test_cancel_keeps_premium_until_paid_expiry(self):
        """[REGRESSION] BUG-063 — la résiliation retirait immédiatement des
        droits déjà payés."""
        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn", "is_premium": True})
        _run_rtdn(_rtdn_payload(3), users_col=users)
        last = users.updates[-1]
        self.assertTrue(last["is_premium"])
        self.assertEqual(last["subscription_status"], "canceled")
        self.assertTrue(last["subscription_expires_at"].startswith("2026-"))

    def test_cancel_without_known_expiry_deactivates(self):
        """Sans échéance connue, `resolve_plan` interpréterait l'absence comme
        « illimité » : on désactive plutôt que d'offrir un Premium perpétuel."""

        async def _no_data(purchase_token, subscription_id):
            _ = (purchase_token, subscription_id)
            return VerificationOutcome.UNAVAILABLE, None

        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn", "is_premium": True})
        _run_rtdn(_rtdn_payload(3), users_col=users, verify=_no_data)
        self.assertFalse(users.updates[-1]["is_premium"])

    def test_grace_period_keeps_access(self):
        """[REGRESSION] BUG-063 — le paiement en nouvelle tentative coupait l'accès."""
        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn"})
        _run_rtdn(_rtdn_payload(6), users_col=users)
        self.assertTrue(users.updates[-1]["is_premium"])

    def test_on_hold_and_paused_revoke_access(self):
        """[REGRESSION] BUG-063 — 5 et 10 n'étaient pas traités du tout."""
        for notif in (5, 10):
            with self.subTest(notification_type=notif):
                users = _FakeUsersCol({"store_purchase_token": "tok_rtdn", "is_premium": True})
                _run_rtdn(_rtdn_payload(notif), users_col=users)
                self.assertFalse(users.updates[-1]["is_premium"])

    def test_expired_revokes_access(self):
        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn", "is_premium": True})
        _run_rtdn(_rtdn_payload(13), users_col=users)
        self.assertFalse(users.updates[-1]["is_premium"])

    def test_unknown_notification_leaves_entitlements_untouched(self):
        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn", "is_premium": True})
        _run_rtdn(_rtdn_payload(99), users_col=users)
        self.assertEqual(users.updates, [])

    def test_activation_never_invents_an_expiry_when_google_is_unreachable(self):
        """[REGRESSION] BUG-062 — une échéance de 30 jours était fabriquée même
        quand la vérification n'avait rien confirmé."""

        async def _unavailable(purchase_token, subscription_id):
            _ = (purchase_token, subscription_id)
            return VerificationOutcome.UNAVAILABLE, None

        users = _FakeUsersCol({"store_purchase_token": "tok_rtdn"})
        _run_rtdn(_rtdn_payload(2), users_col=users, verify=_unavailable)
        last = users.updates[-1]
        self.assertNotIn("subscription_expires_at", last)
        self.assertFalse(last["subscription_verified"])


class RtdnErrorHandlingTests(unittest.TestCase):
    def test_processing_error_surfaces_for_pubsub_retry(self):
        """[REGRESSION] BUG-063 — les erreurs étaient avalées et la route
        renvoyait 200 : l'événement était perdu sans reprise possible."""

        class _ExplodingUsersCol(_FakeUsersCol):
            async def update_one(self, query, update, upsert=False):
                raise RuntimeError("mongo down")

        with self.assertRaises(HTTPException) as ctx:
            _run_rtdn(_rtdn_payload(2), users_col=_ExplodingUsersCol({"x": 1}))
        self.assertEqual(ctx.exception.status_code, 500)

    def test_unreadable_message_returns_ok_without_retry(self):
        """Un message illisible ne gagne rien à être rejoué : 200."""
        users = _FakeUsersCol()
        result = _run_rtdn({"message": {"data": "not-base64!!"}}, users_col=users)
        self.assertEqual(result, {"ok": True})
        self.assertEqual(users.updates, [])


if __name__ == "__main__":
    unittest.main()
