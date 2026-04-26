import importlib
import sys
from pathlib import Path


def test_server_import_registers_test_routes_without_name_error(monkeypatch):
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat_test")
    monkeypatch.setenv("DB_NAME", "keepeat_test")
    monkeypatch.setenv("JWT_SECRET", "test_secret")

    sys.modules.pop("server", None)
    server = importlib.import_module("server")

    paths = {getattr(route, "path", "") for route in server.app.routes}
    assert "/api/test/reset" in paths
    assert "/api/test/seed" in paths
