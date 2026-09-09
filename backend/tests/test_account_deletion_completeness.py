"""Non-régression BUG-069 — suppression de compte complète et conservation bornée.

Deux incohérences relevées par la revue externe du 08/09/2026 :
  - `delete_account` n'exécutait ni la logique de départ du foyer ni la
    révocation Gmail : un propriétaire supprimé laissait un foyer dont
    `owner_id` pointait vers un compte inexistant (l'abonnement partagé se
    résout via ce champ), et l'autorisation Google survivait au compte ;
  - la photo d'un ticket signalé était conservée sans limite, alors que la
    politique de confidentialité affirmait qu'aucune photo n'était stockée.
"""

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

from bson import ObjectId

from backend import server


class _FakeHouseholdsCol:
    def __init__(self, doc=None):
        self.doc = doc
        self.deleted = False
        self.updates: list[dict] = []

    async def find_one(self, query, projection=None):
        _ = (query, projection)
        return dict(self.doc) if self.doc else None

    async def delete_one(self, query):
        _ = query
        self.deleted = True

    async def update_one(self, query, update, upsert=False):
        _ = (query, upsert)
        self.updates.append(update.get("$set", {}))


class _FakeUsersCol:
    def __init__(self, doc=None):
        self.doc = doc or {}

    async def find_one(self, query, projection=None):
        _ = (query, projection)
        return dict(self.doc)


OWNER = "507f1f77bcf86cd799439011"
MEMBER_A = "507f1f77bcf86cd799439022"
MEMBER_B = "507f1f77bcf86cd799439033"
HOUSEHOLD_ID = str(ObjectId())


def _detach(households, user_id=OWNER, household_id=HOUSEHOLD_ID):
    async def _run():
        with patch.object(server, "households_col", households):
            await server._detach_user_from_household(user_id, household_id)

    asyncio.run(_run())


class HouseholdDetachOnAccountDeletionTests(unittest.TestCase):
    def test_owner_deletion_transfers_ownership_instead_of_orphaning(self):
        """[REGRESSION] BUG-069 — le foyer restait avec un propriétaire
        inexistant, ce qui casse la résolution de l'abonnement partagé."""
        households = _FakeHouseholdsCol(
            {"_id": ObjectId(HOUSEHOLD_ID), "owner_id": OWNER, "member_ids": [OWNER, MEMBER_A, MEMBER_B]}
        )

        _detach(households)

        self.assertFalse(households.deleted)
        applied = households.updates[-1]
        self.assertEqual(applied["owner_id"], MEMBER_A)
        self.assertEqual(applied["member_ids"], [MEMBER_A, MEMBER_B])

    def test_member_deletion_only_removes_them(self):
        households = _FakeHouseholdsCol(
            {"_id": ObjectId(HOUSEHOLD_ID), "owner_id": OWNER, "member_ids": [OWNER, MEMBER_A]}
        )

        _detach(households, user_id=MEMBER_A)

        applied = households.updates[-1]
        self.assertEqual(applied["member_ids"], [OWNER])
        self.assertNotIn("owner_id", applied, "la propriété ne change pas inutilement")

    def test_last_member_deletion_removes_the_household(self):
        households = _FakeHouseholdsCol(
            {"_id": ObjectId(HOUSEHOLD_ID), "owner_id": OWNER, "member_ids": [OWNER]}
        )

        _detach(households)

        self.assertTrue(households.deleted)

    def test_missing_household_never_blocks_deletion(self):
        households = _FakeHouseholdsCol(None)
        _detach(households)  # ne doit pas lever
        self.assertEqual(households.updates, [])

    def test_database_failure_never_blocks_deletion(self):
        class _Exploding(_FakeHouseholdsCol):
            async def find_one(self, query, projection=None):
                raise RuntimeError("mongo down")

        _detach(_Exploding({}))  # l'effacement est un droit : il ne doit jamais échouer ici

    def test_user_without_household_is_a_noop(self):
        households = _FakeHouseholdsCol({"_id": ObjectId(HOUSEHOLD_ID)})
        _detach(households, household_id=None)
        self.assertEqual(households.updates, [])


class GmailRevocationOnAccountDeletionTests(unittest.TestCase):
    def _revoke(self, users_col, revoke_calls, decrypted="refresh-token"):
        async def _fake_revoke(token):
            revoke_calls.append(token)

        async def _run():
            with patch.object(server, "users_col", users_col), patch.object(
                server.gmail_oauth_service, "revoke_token", _fake_revoke
            ), patch.object(
                server.gmail_oauth_service, "decrypt_refresh_token", lambda _e: decrypted
            ):
                await server._revoke_gmail_connection_best_effort(OWNER)

        asyncio.run(_run())

    def test_gmail_token_is_revoked_before_account_removal(self):
        """[REGRESSION] BUG-069 — l'autorisation Google survivait au compte."""
        calls: list[str] = []
        self._revoke(
            _FakeUsersCol({"gmail_connection": {"refresh_token_encrypted": "chiffré"}}), calls
        )
        self.assertEqual(calls, ["refresh-token"])

    def test_no_connection_means_no_call(self):
        calls: list[str] = []
        self._revoke(_FakeUsersCol({}), calls)
        self.assertEqual(calls, [])

    def test_undecryptable_token_never_blocks_deletion(self):
        calls: list[str] = []
        self._revoke(
            _FakeUsersCol({"gmail_connection": {"refresh_token_encrypted": "cassé"}}),
            calls,
            decrypted=None,
        )
        self.assertEqual(calls, [])


class ReceiptTicketRetentionTests(unittest.TestCase):
    def test_retention_window_is_bounded_and_configurable(self):
        """[REGRESSION] BUG-069 — aucune durée de conservation n'existait pour
        les photos de tickets signalés."""
        self.assertGreater(server._RECEIPT_TICKET_RETENTION_DAYS, 0)
        self.assertLessEqual(server._RECEIPT_TICKET_RETENTION_DAYS, 365)

    def test_privacy_policy_documents_the_exception(self):
        """La politique affirmait « aucune photo n'est stockée durablement »
        alors que le signalement d'un ticket en conservait une."""
        policy = server._PRIVACY_POLICY_HTML
        self.assertIn("90 jours", policy)
        self.assertNotIn("aucune photo n’est stockée durablement", policy)


if __name__ == "__main__":
    unittest.main()
