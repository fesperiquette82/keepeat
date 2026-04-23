"""Tests de non-régression — BUG-2026-04-10-03 et BUG-2026-04-10-04.

BUG-04 : _upsert_recipe_gap utilisait find_one + insert_one non atomique
         → DuplicateKeyError possible en charge.
         Correction : update_one upsert=True (atomique).

BUG-03 : _upsert_recipe_gap ne doit PAS être appelé quand l'IA a fourni
         une recette (relevant non vide après le bloc IA).
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


# ---------------------------------------------------------------------------
# BUG-2026-04-10-04 — update_one upsert=True (atomique, pas de DuplicateKeyError)
# ---------------------------------------------------------------------------

class TestUpsertRecipeGapAtomic:
    def test_new_gap_uses_update_one_not_insert_one(self, monkeypatch):
        """L'implémentation doit appeler update_one(upsert=True), pas insert_one."""
        server = _load_server(monkeypatch)

        upsert_result = MagicMock()
        upsert_result.upserted_id = "new-object-id"

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.update_one = AsyncMock(return_value=upsert_result)
        col.insert_one = AsyncMock()  # ne doit PAS être appelé

        monkeypatch.setattr(server, "recipe_gap_requests_col", col)
        monkeypatch.setattr(server, "_send_recipe_gap_email", AsyncMock())

        asyncio.run(server._upsert_recipe_gap(
            uid="user-1",
            recipe_filter="stock",
            stock_items=[{"name": "tomate"}, {"name": "oeuf"}],
            criteria={"min_score": 1, "max_missing": 3},
            uncovered_ingredients=["tomate", "oeuf"],
            reference_recipe=None,
        ))

        col.update_one.assert_awaited_once()
        col.insert_one.assert_not_awaited()

        # Vérifier que upsert=True est bien passé
        _, kwargs = col.update_one.call_args
        assert kwargs.get("upsert") is True

    def test_existing_gap_increments_via_update_one(self, monkeypatch):
        """Un gap existant doit aussi passer par update_one (pas un chemin séparé)."""
        server = _load_server(monkeypatch)

        upsert_result = MagicMock()
        upsert_result.upserted_id = None  # document existant, pas de création

        col = MagicMock()
        col.find_one = AsyncMock(return_value={"signature": "sig", "occurrence_count": 3})
        col.update_one = AsyncMock(return_value=upsert_result)

        monkeypatch.setattr(server, "recipe_gap_requests_col", col)
        monkeypatch.setattr(server, "_send_recipe_gap_email", AsyncMock())

        asyncio.run(server._upsert_recipe_gap(
            uid="user-1",
            recipe_filter="stock",
            stock_items=[{"name": "tomate"}],
            criteria={"min_score": 1, "max_missing": 3},
            uncovered_ingredients=["tomate"],
            reference_recipe=None,
        ))

        col.update_one.assert_awaited_once()
        # is_new doit être False → _send_recipe_gap_email appelé avec is_new=False
        _, email_kwargs = server._send_recipe_gap_email.call_args
        assert email_kwargs.get("is_new") is False

    def test_is_new_true_on_upsert_insert(self, monkeypatch):
        """Quand upserted_id est non-None, is_new=True doit être transmis à l'email."""
        server = _load_server(monkeypatch)

        upsert_result = MagicMock()
        upsert_result.upserted_id = "new-id-123"

        col = MagicMock()
        col.find_one = AsyncMock(return_value={"signature": "sig"})
        col.update_one = AsyncMock(return_value=upsert_result)

        monkeypatch.setattr(server, "recipe_gap_requests_col", col)
        email_mock = AsyncMock()
        monkeypatch.setattr(server, "_send_recipe_gap_email", email_mock)

        asyncio.run(server._upsert_recipe_gap(
            uid="user-1",
            recipe_filter="stock",
            stock_items=[{"name": "lait"}],
            criteria={"min_score": 1, "max_missing": 3},
            uncovered_ingredients=["lait"],
            reference_recipe=None,
        ))

        _, email_kwargs = email_mock.call_args
        assert email_kwargs.get("is_new") is True


# ---------------------------------------------------------------------------
# BUG-2026-04-10-03 — gap non loggé quand l'IA fournit une recette
# ---------------------------------------------------------------------------

class TestGapNotLoggedWhenAiSucceeds:
    def _make_ai_recipe(self):
        return {
            "id": "ai-r-1",
            "title": "Recette IA",
            "available_count": 3,
            "missing_count": 0,
            "available_ingredients": ["tomate", "oeuf"],
            "missing_ingredients": [],
            "score": 0.9,
        }

    def test_upsert_gap_not_called_when_ai_succeeds(self, monkeypatch):
        """Si l'IA retourne une recette, _upsert_recipe_gap ne doit pas être appelé."""
        server = _load_server(monkeypatch)

        # Simule : catalogue vide → pas de recettes locales
        class _EmptyCursor:
            async def to_list(self, length=500):
                return []

        stock_col = MagicMock()
        stock_col.find = MagicMock(return_value=_EmptyCursor())
        stock_col.find_one = AsyncMock(return_value=None)
        monkeypatch.setattr(server, "stock_col", stock_col)

        recipes_col = MagicMock()
        recipes_col.find = MagicMock(return_value=_EmptyCursor())
        monkeypatch.setattr(server, "recipes_col", recipes_col)

        # L'IA retourne une recette
        ai_recipe = self._make_ai_recipe()
        monkeypatch.setattr(server, "_ai_gap_fill", AsyncMock(return_value=ai_recipe))
        monkeypatch.setattr(server, "_save_ai_recipe_to_stores", AsyncMock(return_value=ai_recipe))
        monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: "fake-key")

        gap_col = MagicMock()
        gap_col.update_one = AsyncMock()
        monkeypatch.setattr(server, "recipe_gap_requests_col", gap_col)

        current_user = {"id": "507f1f77bcf86cd799439011", "is_premium": False}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/recipes/suggestions?filter=stock")

        # L'IA a réussi → gap ne doit pas avoir été upsert
        gap_col.update_one.assert_not_awaited()
        server.app.dependency_overrides.clear()

    def test_upsert_gap_called_when_ai_fails(self, monkeypatch):
        """Si l'IA échoue et le stock a des ingrédients, le gap est loggé."""
        server = _load_server(monkeypatch)

        class _EmptyCursor:
            async def to_list(self, length=500):
                return []

        stock_col = MagicMock()
        stock_col.find = MagicMock(return_value=_EmptyCursor())
        stock_col.find_one = AsyncMock(return_value=None)
        monkeypatch.setattr(server, "stock_col", stock_col)

        recipes_col = MagicMock()
        recipes_col.find = MagicMock(return_value=_EmptyCursor())
        monkeypatch.setattr(server, "recipes_col", recipes_col)

        # L'IA échoue
        monkeypatch.setattr(server, "_ai_gap_fill", AsyncMock(return_value=None))
        monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: "fake-key")

        upsert_result = MagicMock()
        upsert_result.upserted_id = "new-gap"
        gap_col = MagicMock()
        gap_col.update_one = AsyncMock(return_value=upsert_result)
        gap_col.find_one = AsyncMock(return_value={"signature": "sig"})
        monkeypatch.setattr(server, "recipe_gap_requests_col", gap_col)
        monkeypatch.setattr(server, "_send_recipe_gap_email", AsyncMock())

        # Stock avec des ingrédients
        stock_items = [{"id": "s1", "name": "tomate", "status": "active", "expiry_date": "2030-01-01",
                        "food_category": "legumes", "quantity": "2"}]

        async def fake_stock_find(*args, **kwargs):
            return stock_items

        stock_col.find = MagicMock(return_value=type("C", (), {
            "to_list": AsyncMock(return_value=stock_items),
            "sort": lambda self, *a: self,
        })())

        current_user = {"id": "507f1f77bcf86cd799439011", "is_premium": False}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        client.get("/api/recipes/suggestions?filter=stock")

        # L'IA a échoué et stock non vide → gap doit avoir été upsert
        gap_col.update_one.assert_awaited()
        server.app.dependency_overrides.clear()
