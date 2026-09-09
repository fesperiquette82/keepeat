"""Non-régression BUG-073 — provenance de la date de péremption.

L'app affiche « (estimée) » sur les articles dont la date a été déduite d'une
durée de conservation, et rien sur les dates lues ou saisies. Cet affichage ne
vaut que si CHAQUE chemin d'écriture renseigne `expiry_source` : une estimation
enregistrée sans provenance est présentée comme une certitude.

Trois chemins écrivent du stock avec une date :
  1. `POST /api/stock` (ajout manuel, code-barres, scan de ticket) ;
  2. l'import de tickets par email — couvert par `test_email_import.py` ;
  3. `POST /api/admin/receipt-tickets/{id}/process` (saisie par un admin).
"""

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

from bson import ObjectId

from backend import server
from backend.models import StockItemCreate


class _FakeInsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class _FakeStockCol:
    def __init__(self):
        self.docs: list[dict] = []

    async def find_one(self, query, projection=None):
        _ = (query, projection)
        return None

    async def insert_one(self, doc):
        oid = ObjectId()
        self.docs.append({**doc, "_id": oid})
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
    headers: dict[str, str] = {}


def _add_stock(item: StockItemCreate, *, food_defaults=None) -> dict:
    """Appelle `add_stock` avec des collections factices.

    `food_defaults` simule le cache produit / la résolution IA qui peut fournir
    une durée de conservation quand le client n'a donné aucune date.
    """
    col = _FakeStockCol()

    async def _defaults(**kwargs):
        _ = kwargs
        return food_defaults if food_defaults else (None, None)

    async def _run():
        with patch.object(server, "stock_col", col), patch.object(
            server, "business_events_col", _NoopCol()
        ), patch.object(server, "users_col", _NoopCol()), patch.object(
            server, "_apply_food_defaults_fallback", _defaults
        ):
            await server.add_stock(
                item=item,
                request=_FakeRequest(),
                current_user={"id": "507f1f77bcf86cd799439011"},
            )
        return col.docs[0]

    return asyncio.run(_run())


class AddStockProvenanceTests(unittest.TestCase):
    def test_date_supplied_by_the_client_defaults_to_manual(self):
        """[REGRESSION] BUG-073 — une date saisie ne doit pas être annoncée
        comme une estimation."""
        doc = _add_stock(StockItemCreate(name="Yaourt", expiry_date="2026-10-01"))
        self.assertEqual(doc["expiry_source"], "manual")

    def test_client_can_declare_a_date_read_on_the_packaging(self):
        doc = _add_stock(
            StockItemCreate(name="Yaourt", expiry_date="2026-10-01", expiry_source="label")
        )
        self.assertEqual(doc["expiry_source"], "label")

    def test_client_declaration_of_an_estimate_is_preserved(self):
        """[REGRESSION] BUG-073 — le scan de ticket envoie une date déduite
        d'une durée de conservation : sans provenance déclarée, le serveur la
        rangeait en « saisie manuelle » et l'app la présentait comme sûre."""
        doc = _add_stock(
            StockItemCreate(name="Chips", expiry_date="2027-03-01", expiry_source="estimated")
        )
        self.assertEqual(doc["expiry_source"], "estimated")

    def test_date_deduced_by_the_server_is_marked_as_an_estimate(self):
        doc = _add_stock(
            StockItemCreate(name="Sel fin"), food_defaults=("placard", "2027-03-01")
        )
        self.assertEqual(doc["expiry_date"], "2027-03-01")
        self.assertEqual(doc["expiry_source"], "estimated")

    def test_no_date_declares_no_provenance(self):
        doc = _add_stock(StockItemCreate(name="Sel fin"))
        self.assertIsNone(doc["expiry_date"])
        self.assertIsNone(doc["expiry_source"])


class AdminTicketProvenanceTests(unittest.TestCase):
    """Le chemin admin insère en masse, sans passer par `add_stock`."""

    def _process(self, items: list[dict]) -> list[dict]:
        oid = ObjectId()
        tickets = MagicMock()
        tickets.find_one = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "pending"})
        tickets.find_one_and_update = AsyncMock(
            return_value={"_id": oid, "user_id": "u1", "status": "processing"}
        )
        tickets.update_one = AsyncMock()

        stock = MagicMock()
        stock.delete_many = AsyncMock()
        insert_res = MagicMock()
        insert_res.inserted_ids = [ObjectId() for _ in items]
        stock.insert_many = AsyncMock(return_value=insert_res)

        async def _no_image(name, brand, col):
            _ = (name, brand, col)
            return None

        async def _run():
            with patch.object(server, "receipt_tickets_col", tickets), patch.object(
                server, "stock_col", stock
            ), patch.object(server, "search_openfoodfacts_by_name", _no_image), patch.object(
                server, "send_expo_push", AsyncMock()
            ), patch.object(server, "users_col", _NoopCol()):
                body = server.ProcessReceiptTicketBody(items=items, note="")
                await server.process_receipt_ticket(
                    ticket_id=str(oid),
                    body=body,
                    _admin_user={"id": str(ObjectId()), "email": "admin@keepeat.test"},
                )
            return stock.insert_many.call_args.args[0]

        return asyncio.run(_run())

    def test_admin_typed_date_is_recorded_as_manual(self):
        """[REGRESSION] BUG-073 — ce chemin n'écrivait aucune provenance."""
        docs = self._process([{"name": "Yaourt nature", "expiry_date": "2026-10-01"}])
        self.assertEqual(docs[0]["expiry_source"], "manual")

    def test_item_without_date_declares_no_provenance(self):
        docs = self._process([{"name": "Yaourt nature"}])
        self.assertIsNone(docs[0]["expiry_source"])


if __name__ == "__main__":
    unittest.main()
