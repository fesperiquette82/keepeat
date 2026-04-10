import asyncio
import importlib
import sys
from pathlib import Path

from starlette.responses import Response

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    if "server" in sys.modules:
        del sys.modules["server"]
    return importlib.import_module("server")


def test_admin_add_recipe_route_registered_once(monkeypatch):
    server = _load_server(monkeypatch)

    admin_post_routes = [
        route
        for route in server.api_router.routes
        if getattr(route, "path", None) == "/api/admin/recipes" and "POST" in getattr(route, "methods", set())
    ]

    assert len(admin_post_routes) == 1


class _FakeCursor:
    def __init__(self, payload):
        self._payload = payload

    async def to_list(self, length=500):
        return self._payload


class _FakeRecipesCollection:
    def __init__(self, payload):
        self._payload = payload

    def find(self, _query):
        return _FakeCursor(self._payload)


def test_recipe_suggestions_survives_gap_upsert_failure(monkeypatch):
    server = _load_server(monkeypatch)

    async def fake_fetch_stock_candidates(*, uid, filter_value):
        return [{"name": "Tomate"}]

    async def fake_upsert_recipe_gap(**_kwargs):
        raise RuntimeError("db unavailable")

    captured_meta = {}

    def fake_apply_debug_headers(*, response, meta):
        captured_meta.update(meta)

    monkeypatch.setattr(server, "_fetch_stock_candidates", fake_fetch_stock_candidates)
    monkeypatch.setattr(server, "_upsert_recipe_gap", fake_upsert_recipe_gap)
    monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: None)
    monkeypatch.setattr(server, "recipes_col", _FakeRecipesCollection([]))
    monkeypatch.setattr(server, "_apply_recipes_debug_headers", fake_apply_debug_headers)

    result = asyncio.run(
        server.get_recipe_suggestions(
            response=Response(),
            recipe_filter="urgent",
            include_meta=True,
            suggestion_style="classique",
            locale=None,
            accept_language=None,
            current_user={"id": "user-1"},
        )
    )

    assert result["recipes"] == []
    assert result["meta"]["suggest_later"] is True
    assert result["meta"]["gap_logged"] is False
    assert captured_meta.get("suggest_later") is True
