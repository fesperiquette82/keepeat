"""Tests de non-régression — C3 (suite) : le repli IA de /api/recipes/suggestions
applique désormais le même garde-fou de quota que /api/recipes/ai.

Avant correction, ce repli (déclenché automatiquement dès qu'aucune recette du
catalogue ne matche le stock — jusqu'à 4 fois en parallèle par mutation de
stock côté app, un par filtre temporel) appelait Gemini sans AUCUNE vérification
de plan ou de quota, contrairement à /api/recipes/ai qui réserve le quota
atomiquement avant l'appel et le rembourse en cas d'échec. Un utilisateur au
stock atypique pouvait ainsi déclencher un nombre illimité d'appels IA.

Correction : même paire d'helpers (_enforce_feature_access(consume_quota=True)
+ _refund_feature_quota), dans le même ordre. Différence assumée par rapport à
/api/recipes/ai : un quota épuisé ou un plan qui n'y donne pas droit ne doit PAS
faire échouer /suggestions (l'IA n'est ici qu'un repli parmi d'autres) — il
désactive juste le repli IA pour cet appel, et le mécanisme de gap prend le relais.
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)  # chemin réel (pas is_test_env())
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class FakeAppState:
    """Collection Mongo async minimale en mémoire couvrant les opérations utilisées
    par consume_quota_or_raise / refund_quota (find_one_and_update, find_one).

    Copie de backend/tests/test_quota_cost_ceiling.py::FakeAppState (même contrat).
    """

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


class _EmptyCursor:
    async def to_list(self, length=500):
        return []


def _setup_common(monkeypatch, server, *, app_state_used):
    """Stock non vide (1 article), aucune recette du catalogue ne matche → force le repli IA."""
    stock_items = [{
        "id": "s1", "name": "poulet", "status": "active",
        "expiry_date": "2030-01-01", "food_category": "proteines", "quantity": "1",
    }]
    stock_col = MagicMock()
    stock_col.find = MagicMock(return_value=type("C", (), {
        "to_list": AsyncMock(return_value=stock_items),
    })())
    monkeypatch.setattr(server, "stock_col", stock_col)

    recipes_col = MagicMock()
    recipes_col.find = MagicMock(return_value=_EmptyCursor())
    monkeypatch.setattr(server, "recipes_col", recipes_col)

    monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: "fake-key")

    period = server._current_period_key()
    counter_id = f"usage:507f1f77bcf86cd799439011:ai_recipes:{period}"
    docs = {counter_id: {"_id": counter_id, "used": app_state_used}} if app_state_used is not None else {}
    app_state = FakeAppState(docs)
    monkeypatch.setattr(server, "app_state_col", app_state)

    gap_col = MagicMock()
    gap_col.update_one = AsyncMock(return_value=MagicMock(upserted_id="gap-id"))
    gap_col.find_one = AsyncMock(return_value={"signature": "sig"})
    monkeypatch.setattr(server, "recipe_gap_requests_col", gap_col)
    monkeypatch.setattr(server, "_send_recipe_gap_email", AsyncMock())

    current_user = {"id": "507f1f77bcf86cd799439011", "is_premium": False}
    server.app.dependency_overrides[server._get_current_user] = lambda: current_user
    return app_state, counter_id, gap_col


class TestAiGapFillQuotaEnforcement:
    def test_quota_exhausted_skips_ai_and_still_returns_200(self, monkeypatch):
        """Free plan, limite ai_recipes = 5. À 5/5, le repli IA ne doit PAS appeler
        Gemini (pas d'appel payant au-delà du quota), et /suggestions doit rester
        200 — la réponse dégrade sur le mécanisme de gap plutôt que d'échouer."""
        server = _load_server(monkeypatch)
        app_state, counter_id, gap_col = _setup_common(monkeypatch, server, app_state_used=5)

        ai_mock = AsyncMock()
        monkeypatch.setattr(server, "_ai_gap_fill", ai_mock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/recipes/suggestions?filter=stock")

        assert resp.status_code == 200
        ai_mock.assert_not_awaited()
        gap_col.update_one.assert_awaited()
        server.app.dependency_overrides.clear()

    def test_ai_success_consumes_quota_exactly_once(self, monkeypatch):
        server = _load_server(monkeypatch)
        app_state, counter_id, _ = _setup_common(monkeypatch, server, app_state_used=0)

        ai_recipe = {"title": "Poulet rôti", "ingredients_used": ["poulet"], "instructions_summary": "Cuire."}
        monkeypatch.setattr(server, "_ai_gap_fill", AsyncMock(return_value=ai_recipe))
        monkeypatch.setattr(server, "_save_ai_recipe_to_stores", AsyncMock(return_value={
            "id": "ai-1", "title": "Poulet rôti", "score": 0.8,
            "available_count": 1, "missing_count": 0,
        }))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/recipes/suggestions?filter=stock")

        assert resp.status_code == 200
        assert app_state.docs[counter_id]["used"] == 1
        server.app.dependency_overrides.clear()

    def test_ai_no_usable_recipe_refunds_quota(self, monkeypatch):
        """L'IA a été appelée (réservation faite) mais n'a rien retourné d'utilisable
        → la réservation doit être remboursée (pas de quota consommé sur un échec)."""
        server = _load_server(monkeypatch)
        app_state, counter_id, gap_col = _setup_common(monkeypatch, server, app_state_used=0)
        monkeypatch.setattr(server, "_ai_gap_fill", AsyncMock(return_value=None))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/recipes/suggestions?filter=stock")

        assert resp.status_code == 200
        assert app_state.docs[counter_id]["used"] == 0  # réservé (1) puis remboursé (0)
        gap_col.update_one.assert_awaited()  # repli sur le gap une fois l'IA infructueuse
        server.app.dependency_overrides.clear()
