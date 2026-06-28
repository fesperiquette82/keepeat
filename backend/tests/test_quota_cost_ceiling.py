"""Tests de non-régression — C3 : plafond de coût OCR/IA réel.

Avant correction, l'ordre était : check d'accès SANS lire le compteur → appel
externe payant (Gemini) → consommation du quota. Conséquences :
  - N requêtes concurrentes passaient toutes le check avant le moindre `$inc`
    → dépassement de la limite et appels Gemini facturés au-delà du quota ;
  - un utilisateur déjà à la limite déclenchait quand même un appel payant,
    le 429 ne tombant qu'après.

Correction : le quota est RÉSERVÉ atomiquement AVANT l'appel externe (la
requête au-delà de la limite est rejetée en 429 sans appel payant), puis
REMBOURSÉ si l'appel externe échoue (préserve « pas de quota drainé sur échec »).

Couverture :
  - unité : `refund_quota` décrémente et ne descend jamais sous zéro ;
  - unité : `consume_quota_or_raise` rejette en 429 dès used > limite (réservation) ;
  - endpoint OCR : over-limit → 429 SANS appeler `ocr_receipt` ;
  - endpoint OCR : échec externe → compteur remboursé (net nul), appel bien tenté ;
  - endpoint OCR : succès → quota consommé exactement une fois.

Le endpoint IA (/api/recipes/ai) utilise les mêmes helpers `_enforce_feature_access(
consume_quota=True)` + `_refund_feature_quota` dans le même ordre : il est donc
couvert par construction et par les tests unitaires des helpers partagés.
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)  # chemin réel (pas le mock OCR)
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class FakeAppState:
    """Collection Mongo async minimale en mémoire couvrant les opérations utilisées
    par consume_quota_or_raise / refund_quota (find_one_and_update, find_one)."""

    def __init__(self, docs=None):
        self.docs = dict(docs or {})

    async def find_one_and_update(self, flt, update, upsert=False, return_document=None):
        _id = flt.get("_id")
        doc = self.docs.get(_id)
        inserted = False
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": _id}
            self.docs[_id] = doc
            inserted = True

        # Filtres au-delà de _id (ex. {"used": {"$gt": 0}}) — ignorés sur insert.
        if not inserted:
            for key, cond in flt.items():
                if key == "_id":
                    continue
                if isinstance(cond, dict) and "$gt" in cond:
                    if not (doc.get(key, 0) > cond["$gt"]):
                        return None
                elif doc.get(key) != cond:
                    return None

        for key, val in update.get("$setOnInsert", {}).items():
            doc.setdefault(key, val)
        for key, val in update.get("$inc", {}).items():
            doc[key] = doc.get(key, 0) + val
        for key, val in update.get("$set", {}).items():
            doc[key] = val
        return dict(doc)

    async def find_one(self, flt, projection=None):
        doc = self.docs.get(flt.get("_id"))
        return dict(doc) if doc else None


# ---------------------------------------------------------------------------
# Unité — entitlements
# ---------------------------------------------------------------------------

class TestRefundQuotaUnit:
    def test_refund_decrements_used(self, monkeypatch):
        from backend import entitlements

        col = FakeAppState({"usage:u1:ocr_receipt:2026-06": {"_id": "usage:u1:ocr_receipt:2026-06", "used": 3}})
        asyncio.run(entitlements.refund_quota(
            app_state_col=col, user_id="u1", feature="ocr_receipt", period="2026-06",
        ))
        assert col.docs["usage:u1:ocr_receipt:2026-06"]["used"] == 2

    def test_refund_never_goes_below_zero(self, monkeypatch):
        from backend import entitlements

        col = FakeAppState({"usage:u1:ocr_receipt:2026-06": {"_id": "usage:u1:ocr_receipt:2026-06", "used": 0}})
        asyncio.run(entitlements.refund_quota(
            app_state_col=col, user_id="u1", feature="ocr_receipt", period="2026-06",
        ))
        assert col.docs["usage:u1:ocr_receipt:2026-06"]["used"] == 0

    def test_reservation_raises_429_when_over_limit(self, monkeypatch):
        """consume_quota_or_raise incrémente puis rejette dès used > limite : c'est
        ce qui, placé AVANT l'appel externe, garantit le plafond de coût."""
        from backend import entitlements

        col = FakeAppState({"usage:u1:ocr_receipt:2026-06": {"_id": "usage:u1:ocr_receipt:2026-06", "used": 10}})
        with pytest.raises(HTTPException) as exc:
            asyncio.run(entitlements.consume_quota_or_raise(
                app_state_col=col, user_id="u1", feature="ocr_receipt",
                monthly_limit=10, period="2026-06", reset_at="2026-07-01T00:00:00+00:00",
            ))
        assert exc.value.status_code == 429


# ---------------------------------------------------------------------------
# Endpoint OCR — réservation avant appel + remboursement sur échec
# ---------------------------------------------------------------------------

class TestOcrCostCeiling:
    def _setup(self, monkeypatch, server, used):
        period = server._current_period_key()
        counter_id = f"usage:507f1f77bcf86cd799439011:ocr_receipt:{period}"
        col = FakeAppState({counter_id: {"_id": counter_id, "used": used}} if used is not None else {})
        monkeypatch.setattr(server, "app_state_col", col)
        monkeypatch.setattr(server, "track_business_event", AsyncMock())
        monkeypatch.setattr(server, "track_service_usage", AsyncMock())
        current_user = {"id": "507f1f77bcf86cd799439011", "is_premium": False}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        return col, counter_id

    def test_over_limit_blocks_before_external_call(self, monkeypatch):
        """Free OCR limit = 10. À 10/10, la requête est rejetée en 429 AVANT d'appeler
        ocr_receipt (l'appel payant n'a jamais lieu)."""
        server = _load_server(monkeypatch)
        col, _ = self._setup(monkeypatch, server, used=10)
        ocr_mock = AsyncMock()
        monkeypatch.setattr(server, "ocr_receipt", ocr_mock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/ocr/receipt", json={"image": "data:image/jpeg;base64,/9j/test"})

        assert resp.status_code == 429
        ocr_mock.assert_not_awaited()  # cœur de C3 : pas d'appel payant au-delà du quota
        server.app.dependency_overrides.clear()

    def test_external_failure_refunds_quota(self, monkeypatch):
        """Si l'appel OCR échoue, la réservation est remboursée (compteur inchangé)."""
        server = _load_server(monkeypatch)
        col, counter_id = self._setup(monkeypatch, server, used=5)
        ocr_mock = AsyncMock(side_effect=RuntimeError("boom externe"))
        monkeypatch.setattr(server, "ocr_receipt", ocr_mock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/ocr/receipt", json={"image": "data:image/jpeg;base64,/9j/test"})

        assert resp.status_code == 500
        ocr_mock.assert_awaited_once()  # l'appel a bien été tenté
        assert col.docs[counter_id]["used"] == 5  # réservé (6) puis remboursé (5) → net nul
        server.app.dependency_overrides.clear()

    def test_success_consumes_exactly_once(self, monkeypatch):
        server = _load_server(monkeypatch)
        col, counter_id = self._setup(monkeypatch, server, used=0)
        monkeypatch.setattr(server, "ocr_receipt", AsyncMock(return_value={"date": "2026-06-28", "items": [{"name": "lait"}]}))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/ocr/receipt", json={"image": "data:image/jpeg;base64,/9j/test"})

        assert resp.status_code == 200
        assert col.docs[counter_id]["used"] == 1
        server.app.dependency_overrides.clear()
