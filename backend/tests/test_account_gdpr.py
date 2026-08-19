"""Tests de non-régression — RGPD : export et suppression de compte (BUG-036).

Avant correction, aucun mécanisme d'export ni de suppression de compte
n'existait — alors que Google Play (depuis 2024) et Apple (depuis 2022)
l'exigent pour publier une application qui collecte des données personnelles
(e-mail, stock alimentaire, photos de tickets de caisse). La politique de
confidentialité déjà publiée (`/privacy-policy`) mentionnait par ailleurs
« OpenAI » comme prestataire OCR, alors que le code utilise Google Gemini —
corrigé dans le même lot (un contenu légal publié inexact est un risque de
conformité en soi).

Couverture :
  - GET  /api/account/export  ne retourne que les données du user authentifié.
  - DELETE /api/account       exige le mot de passe (403 sinon, rien supprimé).
  - DELETE /api/account       supprime les collections strictement personnelles.
  - DELETE /api/account       anonymise (ne supprime pas) les journaux
    partagés/agrégés (business_events, service_usage_logs, api_request_logs,
    recipe_gap_requests — dédupliqués entre utilisateurs via `signature`).
  - /privacy-policy et /account-deletion sont publiquement joignables.
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

UID = "507f1f77bcf86cd799439011"


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class _AsyncCursor:
    """Cursor Mongo minimal supportant `async for doc in collection.find(...)`."""

    def __init__(self, docs):
        self._docs = list(docs)

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for doc in self._docs:
            yield doc


def _delete_result(count: int):
    result = MagicMock()
    result.deleted_count = count
    return result


class TestAccountExport:
    def test_export_scopes_data_to_authenticated_user_only(self, monkeypatch):
        server = _load_server(monkeypatch)

        users_col = MagicMock()
        users_col.find_one = AsyncMock(return_value={
            "_id": UID, "email": "moi@example.com", "email_verified": True,
            "is_premium": False, "push_tokens": ["tok-1", "tok-2"],
        })
        monkeypatch.setattr(server, "users_col", users_col)

        stock_col = MagicMock()
        stock_col.find = MagicMock(return_value=_AsyncCursor([
            {"_id": "s1", "user_id": UID, "name": "Tomate"},
        ]))
        monkeypatch.setattr(server, "stock_col", stock_col)

        receipt_tickets_col = MagicMock()
        receipt_tickets_col.find = MagicMock(return_value=_AsyncCursor([
            {"_id": "t1", "user_id": UID, "status": "processed"},
        ]))
        monkeypatch.setattr(server, "receipt_tickets_col", receipt_tickets_col)

        current_user = {"id": UID, "email": "moi@example.com"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/account/export")
        server.app.dependency_overrides.clear()

        assert resp.status_code == 200
        payload = resp.json()
        assert payload["account"]["email"] == "moi@example.com"
        assert payload["account"]["push_tokens_count"] == 2
        assert len(payload["stock_items"]) == 1
        assert payload["stock_items"][0]["name"] == "Tomate"
        assert len(payload["receipt_tickets"]) == 1

        # La requête doit être scopée à cet utilisateur, pas un dump global.
        stock_col.find.assert_called_once_with({"user_id": UID})
        receipt_tickets_col.find.assert_called_once_with({"user_id": UID})

    def test_export_requires_authentication(self, monkeypatch):
        server = _load_server(monkeypatch)
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/account/export")
        assert resp.status_code == 401


class TestAccountDeletion:
    def _setup(self, monkeypatch, server, *, password_ok: bool):
        users_col = MagicMock()
        users_col.find_one = AsyncMock(return_value={"_id": UID, "hashed_password": "hash"})
        users_col.delete_one = AsyncMock()
        monkeypatch.setattr(server, "users_col", users_col)
        monkeypatch.setattr(server, "verify_password", lambda plain, hashed: password_ok)

        stock_col = MagicMock()
        stock_col.delete_many = AsyncMock(return_value=_delete_result(3))
        monkeypatch.setattr(server, "stock_col", stock_col)

        receipt_tickets_col = MagicMock()
        receipt_tickets_col.delete_many = AsyncMock(return_value=_delete_result(2))
        monkeypatch.setattr(server, "receipt_tickets_col", receipt_tickets_col)

        user_alerts_col = MagicMock()
        user_alerts_col.delete_many = AsyncMock(return_value=_delete_result(1))
        monkeypatch.setattr(server, "user_alerts_col", user_alerts_col)

        app_state_col = MagicMock()
        app_state_col.delete_many = AsyncMock(return_value=_delete_result(4))
        monkeypatch.setattr(server, "app_state_col", app_state_col)

        recipe_gap_requests_col = MagicMock()
        recipe_gap_requests_col.update_many = AsyncMock()
        monkeypatch.setattr(server, "recipe_gap_requests_col", recipe_gap_requests_col)

        business_events_col = MagicMock()
        business_events_col.update_many = AsyncMock()
        business_events_col.insert_one = AsyncMock()
        monkeypatch.setattr(server, "business_events_col", business_events_col)

        service_usage_logs_col = MagicMock()
        service_usage_logs_col.update_many = AsyncMock()
        monkeypatch.setattr(server, "service_usage_logs_col", service_usage_logs_col)

        api_request_logs_col = MagicMock()
        api_request_logs_col.update_many = AsyncMock()
        monkeypatch.setattr(server, "api_request_logs_col", api_request_logs_col)

        current_user = {"id": UID, "email": "moi@example.com"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        return {
            "users_col": users_col,
            "stock_col": stock_col,
            "receipt_tickets_col": receipt_tickets_col,
            "user_alerts_col": user_alerts_col,
            "app_state_col": app_state_col,
            "recipe_gap_requests_col": recipe_gap_requests_col,
            "business_events_col": business_events_col,
            "service_usage_logs_col": service_usage_logs_col,
            "api_request_logs_col": api_request_logs_col,
        }

    def test_wrong_password_returns_403_and_deletes_nothing(self, monkeypatch):
        server = _load_server(monkeypatch)
        cols = self._setup(monkeypatch, server, password_ok=False)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.request("DELETE", "/api/account", json={"confirm_password": "wrong"})
        server.app.dependency_overrides.clear()

        assert resp.status_code == 403
        cols["stock_col"].delete_many.assert_not_awaited()
        cols["users_col"].delete_one.assert_not_awaited()

    def test_correct_password_deletes_personal_collections(self, monkeypatch):
        server = _load_server(monkeypatch)
        cols = self._setup(monkeypatch, server, password_ok=True)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.request("DELETE", "/api/account", json={"confirm_password": "correct"})
        server.app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

        cols["stock_col"].delete_many.assert_awaited_once_with({"user_id": UID})
        cols["receipt_tickets_col"].delete_many.assert_awaited_once_with({"user_id": UID})
        cols["user_alerts_col"].delete_many.assert_awaited_once_with({"user_id": UID})
        cols["users_col"].delete_one.assert_awaited_once()

    def test_correct_password_anonymizes_shared_logs_instead_of_deleting(self, monkeypatch):
        """Les journaux partagés/agrégés ne doivent JAMAIS être supprimés en masse —
        seul le user_id qui les rattache à la personne doit être retiré."""
        server = _load_server(monkeypatch)
        cols = self._setup(monkeypatch, server, password_ok=True)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.request("DELETE", "/api/account", json={"confirm_password": "correct"})
        server.app.dependency_overrides.clear()
        assert resp.status_code == 200

        for name in ("recipe_gap_requests_col", "business_events_col", "service_usage_logs_col", "api_request_logs_col"):
            col = cols[name]
            col.delete_many.assert_not_called()
            col.update_many.assert_awaited_once_with({"user_id": UID}, {"$set": {"user_id": None}})

    def test_delete_account_requires_authentication(self, monkeypatch):
        server = _load_server(monkeypatch)
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.request("DELETE", "/api/account", json={"confirm_password": "x"})
        assert resp.status_code == 401


class TestPublicGdprPages:
    def test_privacy_policy_mentions_gemini_not_openai(self, monkeypatch):
        server = _load_server(monkeypatch)
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/privacy-policy")
        assert resp.status_code == 200
        assert "Gemini" in resp.text
        assert "OpenAI" not in resp.text

    def test_privacy_policy_documents_export_and_deletion(self, monkeypatch):
        server = _load_server(monkeypatch)
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/privacy-policy")
        assert "Exporter mes données" in resp.text
        assert "Supprimer mon compte" in resp.text
        assert "/account-deletion" in resp.text

    def test_account_deletion_page_is_publicly_reachable(self, monkeypatch):
        """Exigence Google Play : une page joignable sans connexion ni app installée."""
        server = _load_server(monkeypatch)
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/account-deletion")
        assert resp.status_code == 200
        assert "Réglages" in resp.text
        assert "fesperiquette@hotmail.com" in resp.text
