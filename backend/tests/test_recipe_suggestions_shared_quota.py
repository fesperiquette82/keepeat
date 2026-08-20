"""Tests de non-régression — BUG-048 (audit commercial, recalibrage gratuit/premium).

Avant correction, seul le repli IA de `/api/recipes/suggestions` consommait le
quota `FEATURE_AI` (ai_recipes) — une recette trouvée directement dans le
catalogue local était rendue sans aucune limite pour un utilisateur gratuit.
Pour l'utilisateur, une recette du catalogue et une recette générée par IA
sont indiscernables ("une recette") : les deux tirent désormais sur le même
quota mensuel partagé (8/mois gratuit, 200/mois premium).

Le rafraîchissement en arrière-plan des associations recette/stock (déclenché
jusqu'à 4 fois en parallèle par mutation de stock côté app, un par filtre
temporel — cf. `frontend/store/recipesStore.ts::refreshRecipeAssociationsForStockMutation`)
passe désormais `count_usage=false` pour ne pas vider ce quota sur une action
que l'utilisateur n'a pas demandée activement ; seul l'appel direct depuis
l'écran Recettes (count_usage=True, valeur par défaut) consomme.
"""
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
    monkeypatch.delenv("APP_ENV", raising=False)
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class FakeAppState:
    """Copie de backend/tests/test_quota_cost_ceiling.py::FakeAppState (même contrat)."""

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


class _MatchingCursor:
    async def to_list(self, length=500):
        return [{
            "id": "recipe_1",
            "title": "Poulet rôti",
            "ingredients": [{"name": "poulet", "optional": False}],
            "steps": ["Cuire"],
            "is_active": True,
        }]


def _setup_common(monkeypatch, server, *, app_state_used):
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
    recipes_col.find = MagicMock(return_value=_MatchingCursor())
    monkeypatch.setattr(server, "recipes_col", recipes_col)

    period = server._current_period_key()
    counter_id = f"usage:507f1f77bcf86cd799439011:ai_recipes:{period}"
    docs = {counter_id: {"_id": counter_id, "used": app_state_used}} if app_state_used is not None else {}
    app_state = FakeAppState(docs)
    monkeypatch.setattr(server, "app_state_col", app_state)

    return app_state, counter_id


def _client_for(server, *, is_premium=False):
    current_user = {"id": "507f1f77bcf86cd799439011", "is_premium": is_premium}
    server.app.dependency_overrides[server._get_current_user] = lambda: current_user
    from fastapi.testclient import TestClient
    return TestClient(server.app)


class TestSharedRecipesQuota:
    def test_catalog_hit_consumes_shared_quota(self, monkeypatch):
        """Une recette servie depuis le catalogue local consomme le même compteur
        ai_recipes qu'une recette générée par IA — plus de suggestions catalogue
        illimitées pour un utilisateur gratuit."""
        server = _load_server(monkeypatch)
        app_state, counter_id = _setup_common(monkeypatch, server, app_state_used=0)
        client = _client_for(server)

        resp = client.get("/api/recipes/suggestions?filter=stock")

        assert resp.status_code == 200
        assert resp.json()[0]["id"] == "recipe_1"
        assert app_state.docs[counter_id]["used"] == 1
        server.app.dependency_overrides.clear()

    def test_catalog_hit_blocked_once_free_quota_exhausted(self, monkeypatch):
        """Free plan, limite ai_recipes = 8. À 8/8, la vue directe (count_usage=True
        par défaut) est bloquée en 429 — contrairement au repli IA, qui dégrade
        silencieusement, cette limite doit déclencher le paywall côté app."""
        server = _load_server(monkeypatch)
        _setup_common(monkeypatch, server, app_state_used=8)
        client = _client_for(server)

        resp = client.get("/api/recipes/suggestions?filter=stock")

        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == "QUOTA_EXCEEDED"
        server.app.dependency_overrides.clear()

    def test_background_refresh_does_not_consume_quota(self, monkeypatch):
        """count_usage=false (rafraîchissement en arrière-plan des associations
        recette/stock) ne doit jamais consommer le quota, même à la limite."""
        server = _load_server(monkeypatch)
        app_state, counter_id = _setup_common(monkeypatch, server, app_state_used=8)
        client = _client_for(server)

        resp = client.get("/api/recipes/suggestions?filter=stock&count_usage=false")

        assert resp.status_code == 200
        assert resp.json()[0]["id"] == "recipe_1"
        assert app_state.docs[counter_id]["used"] == 8  # inchangé
        server.app.dependency_overrides.clear()

    def test_premium_plan_never_blocked_by_shared_quota(self, monkeypatch):
        """Premium plan, limite ai_recipes = 200 : jamais bloqué en usage réel."""
        server = _load_server(monkeypatch)
        app_state, counter_id = _setup_common(monkeypatch, server, app_state_used=8)
        client = _client_for(server, is_premium=True)

        resp = client.get("/api/recipes/suggestions?filter=stock")

        assert resp.status_code == 200
        assert app_state.docs[counter_id]["used"] == 9
        server.app.dependency_overrides.clear()
