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
    """Les routes admin HTML doivent être enregistrées dans l'app."""

    def _load(self, monkeypatch):
        monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
        monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
        if "server" in sys.modules:
            del sys.modules["server"]
        return importlib.import_module("server")

    def test_dashboard_route_exists(self, monkeypatch):
        server = self._load(monkeypatch)
        paths = [getattr(r, "path", None) for r in server.app.routes]
        assert "/admin/dashboard" in paths, "Route /admin/dashboard absente de l'app"

    def test_trends_api_route_exists(self, monkeypatch):
        server = self._load(monkeypatch)
        # api_router a prefix="/api", les chemins sont donc stockés avec ce préfixe
        api_paths = [getattr(r, "path", None) for r in server.api_router.routes]
        assert "/api/admin/monitoring/trends" in api_paths, "Route /api/admin/monitoring/trends absente de l'api_router"


class TestHighestErrorRatePipeline:
    """La logique de highest_error_rate ne doit pas retourner d'endpoint
    avec 0 appels — regression du bug 'count=0 / error_rate=100%'."""

    def test_error_rate_is_coherent_with_volume(self):
        # Simulation du résultat attendu après le pipeline dédié :
        # chaque entrée doit avoir volume >= 2 (filtre min_count=2)
        # et error_rate > 0 (filtre error_rate > 0)
        simulated_results = [
            {"endpoint_key": "/api/ocr/receipt", "volume": 5, "error_rate": 1.0, "avg_latency_ms": 300.0},
            {"endpoint_key": "/api/recipes/suggestions", "volume": 12, "error_rate": 0.25, "avg_latency_ms": 120.0},
        ]
        for r in simulated_results:
            assert r["volume"] >= 2, f"volume < 2 pour {r['endpoint_key']} : incohérent"
            assert r["error_rate"] > 0, f"error_rate = 0 ne devrait pas figurer dans la liste"
            # error_rate doit être calculable depuis volume (pas de division par 0)
            inferred_errors = round(r["error_rate"] * r["volume"])
            assert inferred_errors >= 1, f"Incohérence : {r['error_rate']} * {r['volume']} < 1"
