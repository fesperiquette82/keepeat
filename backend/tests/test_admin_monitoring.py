"""Tests de non-régression — admin monitoring / observabilité.

Couvre les fonctions pures utilisées par les endpoints /admin/monitoring/*.
"""
import importlib
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from observability import classify_error_type, normalize_endpoint_key


class TestNormalizeEndpointKey:
    """normalize_endpoint_key remplace les IDs dans les chemins."""

    def test_object_id_replaced(self):
        path = "/api/stock/507f1f77bcf86cd799439011"
        assert normalize_endpoint_key(path) == "/api/stock/:id"

    def test_numeric_id_replaced(self):
        path = "/api/users/42/profile"
        assert normalize_endpoint_key(path) == "/api/users/:id/profile"

    def test_no_id_unchanged(self):
        path = "/api/auth/login"
        assert normalize_endpoint_key(path) == "/api/auth/login"

    def test_multiple_object_ids(self):
        path = "/api/stock/507f1f77bcf86cd799439011/items/deadbeefdeadbeefdeadbeef"
        result = normalize_endpoint_key(path)
        assert result == "/api/stock/:id/items/:id"

    def test_trailing_object_id(self):
        path = "/api/admin/receipt-tickets/507f1f77bcf86cd799439011"
        assert normalize_endpoint_key(path) == "/api/admin/receipt-tickets/:id"


class TestClassifyErrorType:
    """classify_error_type catégorise les codes HTTP."""

    def test_success_no_error(self):
        assert classify_error_type(status_code=200, path="/api/x") is None
        assert classify_error_type(status_code=201, path="/api/x") is None
        assert classify_error_type(status_code=204, path="/api/x") is None

    def test_422_validation_error(self):
        assert classify_error_type(status_code=422, path="/api/x") == "validation_error"

    def test_401_403_auth_error(self):
        assert classify_error_type(status_code=401, path="/api/x") == "auth_error"
        assert classify_error_type(status_code=403, path="/api/x") == "auth_error"

    def test_502_503_external_service_error(self):
        assert classify_error_type(status_code=502, path="/api/x") == "external_service_error"
        assert classify_error_type(status_code=503, path="/api/x") == "external_service_error"

    def test_504_timeout(self):
        assert classify_error_type(status_code=504, path="/api/x") == "timeout"

    def test_500_internal_error(self):
        assert classify_error_type(status_code=500, path="/api/x") == "internal_error"
        assert classify_error_type(status_code=520, path="/api/x") == "internal_error"

    def test_admin_path_4xx_auth_error(self):
        # Toute erreur 4xx sur un path admin → auth_error
        assert classify_error_type(status_code=404, path="/api/admin/monitoring") == "auth_error"

    def test_non_admin_4xx_client_error(self):
        assert classify_error_type(status_code=404, path="/api/stock/xyz") == "client_error"
        assert classify_error_type(status_code=400, path="/api/auth/login") == "client_error"


class TestAdminDashboardRouteRegistered:
    """La route /admin/dashboard doit être enregistrée dans l'app."""

    def test_dashboard_route_exists(self, monkeypatch):
        monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
        monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
        if "server" in sys.modules:
            del sys.modules["server"]
        server = importlib.import_module("server")

        paths = [getattr(r, "path", None) for r in server.app.routes]
        assert "/admin/dashboard" in paths, "Route /admin/dashboard absente de l'app"
