"""Non-régression BUG-065 — un ajout rejoué ne crée pas de doublon.

Quand la réponse d'un POST /api/stock se perd (réseau coupé juste après
l'écriture), la file hors ligne rejoue l'action. Sans identifiant stable de
mutation, ce rejeu créait un second article identique. Le client envoie donc
`X-Mutation-Id` et le serveur renvoie l'article déjà créé.
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
from pymongo.errors import DuplicateKeyError

from backend import server
from backend.models import StockItemCreate


class _FakeInsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class _FakeStockCol:
    """Collection minimale honorant `client_mutation_id` et l'unicité associée."""

    def __init__(self, raise_duplicate_on_insert=False):
        self.docs: list[dict] = []
        self.insert_calls = 0
        self.raise_duplicate_on_insert = raise_duplicate_on_insert

    async def find_one(self, query, projection=None):
        _ = projection
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items() if not isinstance(v, dict)):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self.insert_calls += 1
        if self.raise_duplicate_on_insert:
            raise DuplicateKeyError("client_mutation_id")
        oid = ObjectId()
        stored = {**doc, "_id": oid}
        self.docs.append(stored)
        return _FakeInsertResult(oid)


class _NoopCol:
    async def insert_one(self, _doc):
        return None

    async def update_one(self, *args, **kwargs):
        class _R:
            modified_count = 0

        return _R()

    async def find_one(self, *args, **kwargs):
        return None


class _FakeRequest:
    def __init__(self, headers=None):
        self.headers = headers or {}


def _add_stock(stock_col, headers):
    item = StockItemCreate(name="Lait demi-écrémé", quantity="1L")

    async def _no_defaults(**kwargs):
        _ = kwargs
        return None, None

    async def _run():
        with patch.object(server, "stock_col", stock_col), patch.object(
            server, "business_events_col", _NoopCol()
        ), patch.object(server, "users_col", _NoopCol()), patch.object(
            server, "_apply_food_defaults_fallback", _no_defaults
        ):
            return await server.add_stock(
                item=item,
                request=_FakeRequest(headers),
                current_user={"id": "507f1f77bcf86cd799439011"},
            )

    return asyncio.run(_run())


class StockMutationIdempotencyTests(unittest.TestCase):
    def test_replayed_add_returns_existing_item_without_duplicating(self):
        """[REGRESSION] BUG-065 — le rejeu d'un ajout dont la réponse s'est
        perdue créait un doublon en stock."""
        col = _FakeStockCol()
        headers = {"X-Mutation-Id": "mut-abc"}

        first = _add_stock(col, headers)
        second = _add_stock(col, headers)

        self.assertEqual(col.insert_calls, 1, "aucun second insert ne doit avoir lieu")
        self.assertEqual(len(col.docs), 1)
        self.assertEqual(first["id"], second["id"])

    def test_two_distinct_mutations_create_two_items(self):
        col = _FakeStockCol()

        _add_stock(col, {"X-Mutation-Id": "mut-1"})
        _add_stock(col, {"X-Mutation-Id": "mut-2"})

        self.assertEqual(col.insert_calls, 2)
        self.assertEqual(len(col.docs), 2)

    def test_without_header_behaviour_is_unchanged(self):
        """Un client qui n'envoie pas d'identifiant garde l'ancien comportement."""
        col = _FakeStockCol()

        _add_stock(col, {})
        _add_stock(col, {})

        self.assertEqual(col.insert_calls, 2)
        self.assertNotIn("client_mutation_id", col.docs[0])

    def test_concurrent_replay_resolved_by_unique_index(self):
        """Deux rejeux simultanés : l'index unique tranche, on renvoie l'article
        gagnant plutôt qu'une erreur."""
        col = _FakeStockCol(raise_duplicate_on_insert=True)
        col.docs.append({
            "_id": ObjectId(),
            "user_id": "507f1f77bcf86cd799439011",
            "client_mutation_id": "mut-race",
            "name": "Lait demi-écrémé",
            "added_date": "2026-09-08T00:00:00+00:00",
            "status": "active",
        })

        result = _add_stock(col, {"X-Mutation-Id": "mut-race"})

        self.assertEqual(result["name"], "Lait demi-écrémé")

    def test_mutation_id_is_truncated_to_a_safe_length(self):
        col = _FakeStockCol()
        _add_stock(col, {"X-Mutation-Id": "x" * 200})
        self.assertEqual(len(col.docs[0]["client_mutation_id"]), 64)


if __name__ == "__main__":
    unittest.main()
