"""Tests de non-régression — admin_service_control + endpoint reset logs API.

Couvre les services post-migration Gemini :
- ocr_engine utilise GEMINI_OCR_API_KEY
- gemini_recipes est tracké avec GEMINI_RECIPES_API_KEY
- build_cost_recommendations retourne "Gemini 2.5-flash (Free)" comme plan OCR par défaut

Couvre également le nouvel endpoint DELETE /admin/monitoring/logs/api-requests.
"""
import asyncio
import importlib
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from admin_service_control import (
    SERVICE_REGISTRY,
    build_cost_recommendations,
    build_usage_metrics,
)


# ---------------------------------------------------------------------------
# SERVICE_REGISTRY — structure
# ---------------------------------------------------------------------------

class TestServiceRegistry:
    def _get(self, service_id: str):
        return next((s for s in SERVICE_REGISTRY if s["id"] == service_id), None)

    def test_ocr_engine_uses_gemini_key(self):
        svc = self._get("ocr_engine")
        assert svc is not None
        assert svc["enabled_env"] == "GEMINI_OCR_API_KEY"

    def test_gemini_recipes_service_present(self):
        svc = self._get("gemini_recipes")
        assert svc is not None, "gemini_recipes doit être dans SERVICE_REGISTRY"
        assert svc["enabled_env"] == "GEMINI_RECIPES_API_KEY"
        assert svc["type"] == "external"

    def test_all_required_services_present(self):
        ids = {s["id"] for s in SERVICE_REGISTRY}
        for required in ("keepeat_backend_api", "mongodb", "openfoodfacts_api",
                         "ocr_engine", "gemini_recipes", "frontend_backend_connectivity"):
            assert required in ids, f"Service manquant dans le registre : {required}"

    def test_ocr_engine_name_updated(self):
        svc = self._get("ocr_engine")
        assert "openai" not in svc["name"].lower(), (
            "Le nom de ocr_engine ne doit plus mentionner OpenAI"
        )
        assert "gemini" in svc["name"].lower(), (
            "Le nom de ocr_engine doit mentionner Gemini"
        )


# ---------------------------------------------------------------------------
# build_cost_recommendations — plan OCR par défaut
# ---------------------------------------------------------------------------

class FakeUsageCollection:
    async def count_documents(self, _query):
        return 0


def _make_empty_usage_payload():
    return asyncio.run(build_usage_metrics(
        users_col=FakeUsageCollection(),
        stock_col=FakeUsageCollection(),
        service_usage_logs_col=FakeUsageCollection(),
    ))


class TestBuildCostRecommendations:
    def test_default_ocr_plan_is_gemini(self, monkeypatch):
        monkeypatch.delenv("MONITORING_OCR_CURRENT_PLAN", raising=False)
        usage = _make_empty_usage_payload()
        result = asyncio.run(build_cost_recommendations(usage_payload=usage))
        ocr_cost = next(c for c in result["costs"] if c["service_id"] == "ocr_engine")
        assert "gemini" in ocr_cost["current_plan"].lower(), (
            f"Le plan OCR par défaut doit mentionner Gemini, obtenu : {ocr_cost['current_plan']}"
        )
        assert "openai" not in ocr_cost["current_plan"].lower(), (
            "Le plan OCR par défaut ne doit plus mentionner OpenAI"
        )

    def test_ocr_plan_overridable_via_env(self, monkeypatch):
        monkeypatch.setenv("MONITORING_OCR_CURRENT_PLAN", "My Custom Plan")
        usage = _make_empty_usage_payload()
        result = asyncio.run(build_cost_recommendations(usage_payload=usage))
        ocr_cost = next(c for c in result["costs"] if c["service_id"] == "ocr_engine")
        assert ocr_cost["current_plan"] == "My Custom Plan"


# ---------------------------------------------------------------------------
# DELETE /admin/monitoring/logs/api-requests — endpoint reset logs
# ---------------------------------------------------------------------------

def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class TestAdminResetApiLogsEndpoint:
    def test_correct_password_deletes_logs(self, monkeypatch):
        server = _load_server(monkeypatch)
        from auth_utils import hash_password

        hashed = hash_password("goodpassword")
        server.users_col.find_one = AsyncMock(return_value={"hashed_password": hashed})
        delete_result = MagicMock()
        delete_result.deleted_count = 42
        server.api_request_logs_col.delete_many = AsyncMock(return_value=delete_result)
        server.app.dependency_overrides[server._require_admin_user] = lambda: {
            "id": "507f1f77bcf86cd799439011", "email": "admin@test.com", "is_admin": True
        }

        client = TestClient(server.app)
        resp = client.request(
            "DELETE",
            "/api/admin/monitoring/logs/api-requests",
            json={"confirm_password": "goodpassword"},
        )
        assert resp.status_code == 200
        assert resp.json()["deleted_count"] == 42
        server.api_request_logs_col.delete_many.assert_awaited_once()
        server.app.dependency_overrides.clear()

    def test_wrong_password_returns_403(self, monkeypatch):
        server = _load_server(monkeypatch)
        from auth_utils import hash_password

        hashed = hash_password("goodpassword")
        server.users_col.find_one = AsyncMock(return_value={"hashed_password": hashed})
        server.app.dependency_overrides[server._require_admin_user] = lambda: {
            "id": "507f1f77bcf86cd799439011", "email": "admin@test.com", "is_admin": True
        }

        client = TestClient(server.app)
        resp = client.request(
            "DELETE",
            "/api/admin/monitoring/logs/api-requests",
            json={"confirm_password": "wrongpassword"},
        )
        assert resp.status_code == 403
        assert "mot de passe" in resp.json()["detail"].lower()
        server.app.dependency_overrides.clear()

    def test_unauthenticated_returns_4xx(self, monkeypatch):
        server = _load_server(monkeypatch)
        client = TestClient(server.app)
        resp = client.request(
            "DELETE",
            "/api/admin/monitoring/logs/api-requests",
            json={"confirm_password": "any"},
        )
        assert resp.status_code in (401, 403)
