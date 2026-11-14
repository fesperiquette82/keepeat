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


def test_no_route_exposes_a_mongo_handle_as_request_parameter():
    """[REGRESSION] BUG-088 — `/api/debug/logs/upload` dépendait directement de
    `auth_utils.get_current_user(users_col, credentials)` : FastAPI a fait de
    `users_col` un paramètre de requête obligatoire, et la route a rejeté en
    422 tous les envois réels. Les fonctions qui reçoivent une collection
    s'appellent depuis une enveloppe (`_get_current_user`), jamais par
    `Depends` directement."""
    from fastapi.routing import APIRoute

    from backend import server

    # Les routeurs inclus apparaissent dans app.routes sous une enveloppe
    # paresseuse : leurs routes se lisent sur le routeur lui-même.
    routes = list(server.app.routes) + list(server.api_router.routes)
    assert any(getattr(r, "path", "") == "/api/debug/logs/upload" for r in routes)
    offenders = []
    for route in routes:
        if not isinstance(route, APIRoute):
            continue
        params = route.dependant.query_params + route.dependant.body_params
        for sub in route.dependant.dependencies:
            params = params + sub.query_params + sub.body_params
        for param in params:
            if param.name == "db" or param.name.endswith("_col"):
                offenders.append(f"{route.path}:{param.name}")
    assert offenders == []
