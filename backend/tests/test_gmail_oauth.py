"""Tests de non-régression — BUG-050 (import mail des tickets, phase 1).

Phase 1 : connexion/déconnexion OAuth Gmail uniquement (consentement,
stockage chiffré du refresh_token). Aucune recherche ni parsing d'email.
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from bson import ObjectId
from cryptography.fernet import Fernet

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

ENCRYPTION_KEY = Fernet.generate_key().decode("utf-8")


def _load_server(monkeypatch, *, configured=True):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)
    if configured:
        monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
        monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")
        monkeypatch.setenv("GMAIL_TOKEN_ENCRYPTION_KEY", ENCRYPTION_KEY)
    else:
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("GMAIL_TOKEN_ENCRYPTION_KEY", raising=False)
    for mod in ("server", "models", "gmail_oauth_service"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class FakeMongoCollection:
    def __init__(self, docs=None):
        self.docs: dict[str, dict] = {}
        for doc in docs or []:
            self.docs[str(doc["_id"])] = dict(doc)

    async def find_one(self, flt, projection=None):
        _id = flt.get("_id")
        doc = self.docs.get(str(_id)) if _id is not None else None
        return dict(doc) if doc else None

    async def update_one(self, flt, update):
        _id = flt.get("_id")
        doc = self.docs.get(str(_id))
        if doc is None:
            return type("Result", (), {"matched_count": 0})()
        for key, val in update.get("$set", {}).items():
            doc[key] = val
        for key in update.get("$unset", {}):
            doc.pop(key, None)
        return type("Result", (), {"matched_count": 1})()


USER_ID = "507f1f77bcf86cd799439011"


class TestGmailOAuthService:
    def test_not_configured_raises_on_auth_url(self, monkeypatch):
        from backend import gmail_oauth_service
        importlib.reload(gmail_oauth_service)
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
        assert gmail_oauth_service.is_configured() is False
        with pytest.raises(gmail_oauth_service.GmailOAuthNotConfigured):
            gmail_oauth_service.build_authorization_url(user_id=USER_ID)

    def test_build_authorization_url_contains_expected_params(self, monkeypatch):
        from backend import gmail_oauth_service
        monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
        monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
        monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
        result = gmail_oauth_service.build_authorization_url(user_id=USER_ID)
        assert "client_id=cid" in result["authorization_url"]
        assert "gmail.readonly" in result["authorization_url"]
        assert "access_type=offline" in result["authorization_url"]
        assert result["state"]

    def test_state_token_roundtrip(self, monkeypatch):
        from backend import gmail_oauth_service
        monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
        state = gmail_oauth_service.generate_state_token(USER_ID)
        assert gmail_oauth_service.decode_state_token(state) == USER_ID

    def test_state_token_rejects_garbage(self, monkeypatch):
        from backend import gmail_oauth_service
        monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
        with pytest.raises(ValueError):
            gmail_oauth_service.decode_state_token("not-a-jwt")

    def test_encrypt_decrypt_refresh_token_roundtrip(self, monkeypatch):
        from backend import gmail_oauth_service
        monkeypatch.setenv("GMAIL_TOKEN_ENCRYPTION_KEY", ENCRYPTION_KEY)
        encrypted = gmail_oauth_service.encrypt_refresh_token("secret-refresh-token")
        assert encrypted != "secret-refresh-token"
        assert gmail_oauth_service.decrypt_refresh_token(encrypted) == "secret-refresh-token"

    def test_decrypt_returns_none_on_corrupted_token(self, monkeypatch):
        from backend import gmail_oauth_service
        monkeypatch.setenv("GMAIL_TOKEN_ENCRYPTION_KEY", ENCRYPTION_KEY)
        assert gmail_oauth_service.decrypt_refresh_token("garbage") is None


class TestGmailEndpoints:
    def test_auth_url_returns_503_when_not_configured(self, monkeypatch):
        server = _load_server(monkeypatch, configured=False)
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/gmail/auth-url")

        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "GMAIL_OAUTH_NOT_CONFIGURED"
        server.app.dependency_overrides.clear()

    def test_auth_url_success(self, monkeypatch):
        server = _load_server(monkeypatch, configured=True)
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/gmail/auth-url")

        assert resp.status_code == 200
        body = resp.json()
        assert "accounts.google.com" in body["authorization_url"]
        assert body["state"]
        server.app.dependency_overrides.clear()

    def test_connect_rejects_state_for_different_user(self, monkeypatch):
        server = _load_server(monkeypatch, configured=True)
        other_state = server.gmail_oauth_service.generate_state_token("other-user-id")
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/integrations/gmail/connect", json={"code": "abc", "state": other_state})

        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INVALID_OAUTH_STATE"
        server.app.dependency_overrides.clear()

    def test_connect_success_stores_encrypted_token(self, monkeypatch):
        server = _load_server(monkeypatch, configured=True)
        users_col = FakeMongoCollection([{"_id": ObjectId(USER_ID), "email": "a@b.com"}])
        monkeypatch.setattr(server, "users_col", users_col)
        monkeypatch.setattr(server, "track_business_event", AsyncMock())
        monkeypatch.setattr(
            server.gmail_oauth_service, "exchange_code_for_tokens",
            AsyncMock(return_value={"refresh_token": "rt-123", "access_token": "at-123"}),
        )
        state = server.gmail_oauth_service.generate_state_token(USER_ID)
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/integrations/gmail/connect", json={"code": "abc", "state": state})

        assert resp.status_code == 200
        body = resp.json()
        assert body["connected"] is True
        stored = users_col.docs[USER_ID]["gmail_connection"]
        assert stored["refresh_token_encrypted"] != "rt-123"
        assert server.gmail_oauth_service.decrypt_refresh_token(stored["refresh_token_encrypted"]) == "rt-123"
        server.app.dependency_overrides.clear()

    def test_connect_without_refresh_token_fails_explicitly(self, monkeypatch):
        server = _load_server(monkeypatch, configured=True)
        monkeypatch.setattr(
            server.gmail_oauth_service, "exchange_code_for_tokens",
            AsyncMock(return_value={"access_token": "at-123"}),
        )
        state = server.gmail_oauth_service.generate_state_token(USER_ID)
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/integrations/gmail/connect", json={"code": "abc", "state": state})

        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "NO_REFRESH_TOKEN"
        server.app.dependency_overrides.clear()

    def test_status_reflects_connection(self, monkeypatch):
        server = _load_server(monkeypatch, configured=True)
        users_col = FakeMongoCollection([{
            "_id": ObjectId(USER_ID), "email": "a@b.com",
            "gmail_connection": {"connected": True, "connected_at": "2026-01-01T00:00:00+00:00", "status": "connected"},
        }])
        monkeypatch.setattr(server, "users_col", users_col)
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/gmail/status")

        assert resp.status_code == 200
        assert resp.json() == {"connected": True, "connected_at": "2026-01-01T00:00:00+00:00", "status": "connected"}
        server.app.dependency_overrides.clear()

    def test_status_disconnected_by_default(self, monkeypatch):
        server = _load_server(monkeypatch, configured=True)
        users_col = FakeMongoCollection([{"_id": ObjectId(USER_ID), "email": "a@b.com"}])
        monkeypatch.setattr(server, "users_col", users_col)
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/gmail/status")

        assert resp.status_code == 200
        assert resp.json()["connected"] is False
        server.app.dependency_overrides.clear()

    def test_disconnect_clears_connection_even_if_revoke_fails(self, monkeypatch):
        server = _load_server(monkeypatch, configured=True)
        encrypted = server.gmail_oauth_service.encrypt_refresh_token("rt-123")
        users_col = FakeMongoCollection([{
            "_id": ObjectId(USER_ID), "email": "a@b.com",
            "gmail_connection": {"connected": True, "refresh_token_encrypted": encrypted, "status": "connected"},
        }])
        monkeypatch.setattr(server, "users_col", users_col)
        monkeypatch.setattr(server, "track_business_event", AsyncMock())
        monkeypatch.setattr(server.gmail_oauth_service, "revoke_token", AsyncMock(return_value=False))
        current_user = {"id": USER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/integrations/gmail/disconnect")

        assert resp.status_code == 200
        assert resp.json()["connected"] is False
        assert "gmail_connection" not in users_col.docs[USER_ID]
        server.app.dependency_overrides.clear()
