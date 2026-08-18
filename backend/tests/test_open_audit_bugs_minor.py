"""Tests de non-régression — bugs MINEURS ouverts dans AUDIT_BUGS.md.

Couvre : BUG-006, BUG-008, BUG-011, BUG-012, BUG-013, BUG-014, BUG-015, BUG-030, BUG-031.
"""
import datetime
import importlib
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

SERVER_SRC_PATH = BACKEND_DIR / "server.py"


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


# ---------------------------------------------------------------------------
# BUG-006 — SuggestionStyle défini avant son utilisation dans recipes_service.py
# ---------------------------------------------------------------------------

def test_suggestion_style_alias_defined_before_first_use():
    src = (BACKEND_DIR / "recipes_service.py").read_text(encoding="utf-8")
    definition_pos = src.index("SuggestionStyle = Literal[")
    first_use_pos = src.index("suggestion_style: SuggestionStyle")
    assert definition_pos < first_use_pos, (
        "SuggestionStyle doit être défini avant sa première utilisation "
        "dans une signature de fonction (BUG-006)"
    )


def test_suggestion_style_alias_defined_only_once():
    src = (BACKEND_DIR / "recipes_service.py").read_text(encoding="utf-8")
    assert src.count("SuggestionStyle = Literal[") == 1


# ---------------------------------------------------------------------------
# BUG-008 — cache IA : éviction LRU bornée, testable indépendamment de l'endpoint
# ---------------------------------------------------------------------------

class TestAiCacheEviction:
    def test_no_eviction_below_max_size(self, monkeypatch):
        server = _load_server(monkeypatch)
        cache = {"u1": {"recipes": [], "created_at": datetime.datetime(2026, 1, 1)}}
        server._evict_ai_cache_entry_if_full(cache, max_size=2)
        assert "u1" in cache

    def test_evicts_oldest_entry_when_full(self, monkeypatch):
        server = _load_server(monkeypatch)
        cache = {
            "old": {"recipes": [], "created_at": datetime.datetime(2026, 1, 1)},
            "new": {"recipes": [], "created_at": datetime.datetime(2026, 6, 1)},
        }
        server._evict_ai_cache_entry_if_full(cache, max_size=2)
        assert "old" not in cache
        assert "new" in cache

    def test_cache_stays_bounded_across_many_inserts(self, monkeypatch):
        server = _load_server(monkeypatch)
        cache: dict = {}
        max_size = 5
        for i in range(20):
            server._evict_ai_cache_entry_if_full(cache, max_size)
            cache[f"user-{i}"] = {"recipes": [], "created_at": datetime.datetime(2026, 1, 1, 0, 0, i)}
        assert len(cache) == max_size
        # Les entrées les plus récentes doivent être conservées.
        assert "user-19" in cache
        assert "user-0" not in cache

    def test_cache_is_per_process_not_shared_across_workers_documented(self):
        src = SERVER_SRC_PATH.read_text(encoding="utf-8")
        marker_pos = src.index("_ai_recipe_cache: dict[str, dict] = {}")
        preceding_comment = src[max(0, marker_pos - 500):marker_pos]
        assert "PAS partagé entre les workers" in preceding_comment


# ---------------------------------------------------------------------------
# BUG-011 — update_stock : find_one final scopé par user_id
# ---------------------------------------------------------------------------

class TestUpdateStockScopedByUser:
    def test_final_lookup_is_scoped_by_user_id(self, monkeypatch):
        server = _load_server(monkeypatch)
        oid = ObjectId()
        current_user = {"id": "user-1"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        stock = MagicMock()
        update_result = MagicMock()
        update_result.matched_count = 1
        stock.update_one = AsyncMock(return_value=update_result)
        stock.find_one = AsyncMock(return_value={
            "_id": oid,
            "user_id": "user-1",
            "name": "Lait",
            "added_date": "2026-08-01T00:00:00",
            "status": "active",
        })
        monkeypatch.setattr(server, "stock_col", stock)
        monkeypatch.setattr(server, "track_business_event", AsyncMock())

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.put(f"/api/stock/{oid}", json={"name": "Lait demi-écrémé"})

        assert resp.status_code == 200
        # Le find_one final doit filtrer par user_id (pas seulement par _id) — BUG-011.
        final_call_kwargs = stock.find_one.call_args
        query = final_call_kwargs.args[0] if final_call_kwargs.args else final_call_kwargs.kwargs.get("filter")
        assert query.get("user_id") == "user-1"
        server.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# BUG-012 — get_stock : pagination configurable au lieu d'une limite figée
# ---------------------------------------------------------------------------

class _FakeStockCursor:
    def __init__(self, payload):
        self._payload = payload
        self.sort_args = None
        self.skip_args = None
        self.limit_args = None

    def sort(self, *args):
        self.sort_args = args
        return self

    def skip(self, n):
        self.skip_args = n
        return self

    def limit(self, n):
        self.limit_args = n
        return self

    async def to_list(self, length=None):
        return self._payload


class TestGetStockPagination:
    def test_default_limit_matches_previous_behavior(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": "user-1"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        fake_cursor = _FakeStockCursor([])
        stock = MagicMock()
        stock.find = MagicMock(return_value=fake_cursor)
        monkeypatch.setattr(server, "stock_col", stock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/stock")
        assert resp.status_code == 200
        assert fake_cursor.limit_args == 1000
        assert fake_cursor.skip_args == 0
        server.app.dependency_overrides.clear()

    def test_custom_limit_and_skip_are_applied(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": "user-1"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        fake_cursor = _FakeStockCursor([])
        stock = MagicMock()
        stock.find = MagicMock(return_value=fake_cursor)
        monkeypatch.setattr(server, "stock_col", stock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/stock", params={"limit": 50, "skip": 100})
        assert resp.status_code == 200
        assert fake_cursor.limit_args == 50
        assert fake_cursor.skip_args == 100
        server.app.dependency_overrides.clear()

    def test_limit_is_bounded(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": "user-1"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/stock", params={"limit": 999999})
        assert resp.status_code == 422
        server.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# BUG-013 — source du business event "recipe_generated" = gemini, pas openai
# ---------------------------------------------------------------------------

def test_recipe_generated_event_source_is_gemini_not_openai():
    src = SERVER_SRC_PATH.read_text(encoding="utf-8")
    assert '"source": "openai"' not in src
    assert '"count": len(recipes), "source": "gemini"' in src


# ---------------------------------------------------------------------------
# BUG-014 — SHELF_BY_CATEGORY : source unique (ocr_service), plus de duplication
# ---------------------------------------------------------------------------

def test_shelf_by_category_is_not_duplicated(monkeypatch):
    server = _load_server(monkeypatch)
    from backend import ocr_service as backend_ocr_service

    assert not hasattr(server, "_SHELF_BY_CATEGORY")
    # server.py importe SHELF_BY_CATEGORY depuis backend.ocr_service : même objet, pas une copie.
    assert server.SHELF_BY_CATEGORY is backend_ocr_service.SHELF_BY_CATEGORY


# ---------------------------------------------------------------------------
# BUG-015 / BUG-2026-04-10-05 — plus de mention obsolète "GPT-4o-mini"
# ---------------------------------------------------------------------------

def test_no_stale_gpt4o_mini_mentions_in_server():
    src = SERVER_SRC_PATH.read_text(encoding="utf-8")
    assert "GPT-4o-mini" not in src
    assert "GPT-4o mini" not in src


# ---------------------------------------------------------------------------
# BUG-030 — admin_dedup_recipes garde la recette la plus ancienne par created_at
# ---------------------------------------------------------------------------

class TestAdminDedupRecipesOrdering:
    def test_keeps_oldest_by_created_at_not_lexicographic_id(self, monkeypatch):
        server = _load_server(monkeypatch)
        admin = {"id": str(ObjectId()), "email": "admin@keepeat.test"}
        server.app.dependency_overrides[server._require_admin_user] = lambda: admin

        # L'id lexicographiquement le plus petit ("ai-tarte-000a") est en réalité
        # le PLUS RÉCENT (créé après "manual-tarte-999z") — le tri doit se baser
        # sur created_at, pas sur l'id.
        group = {
            "_id": "tarte aux pommes",
            "count": 2,
            "entries": [
                {"id": "ai-tarte-000a", "created_at": "2026-06-01T00:00:00"},
                {"id": "manual-tarte-999z", "created_at": "2026-01-01T00:00:00"},
            ],
        }

        class _FakeAggCursor:
            async def to_list(self, length=None):
                return [group]

        recipes = MagicMock()
        recipes.aggregate = MagicMock(return_value=_FakeAggCursor())
        delete_result = MagicMock()
        delete_result.deleted_count = 1
        recipes.delete_many = AsyncMock(return_value=delete_result)
        monkeypatch.setattr(server, "recipes_col", recipes)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/admin/recipes/dedup")

        assert resp.status_code == 200
        body = resp.json()
        assert body["details"][0]["kept"] == "manual-tarte-999z"
        assert body["details"][0]["removed"] == ["ai-tarte-000a"]
        server.app.dependency_overrides.clear()

    def test_entries_without_created_at_are_treated_as_oldest(self, monkeypatch):
        server = _load_server(monkeypatch)
        admin = {"id": str(ObjectId()), "email": "admin@keepeat.test"}
        server.app.dependency_overrides[server._require_admin_user] = lambda: admin

        group = {
            "_id": "soupe",
            "count": 2,
            "entries": [
                {"id": "manual-soupe-aaaa", "created_at": "2026-03-01T00:00:00"},
                {"id": "legacy-soupe-id", "created_at": None},
            ],
        }

        class _FakeAggCursor:
            async def to_list(self, length=None):
                return [group]

        recipes = MagicMock()
        recipes.aggregate = MagicMock(return_value=_FakeAggCursor())
        delete_result = MagicMock()
        delete_result.deleted_count = 1
        recipes.delete_many = AsyncMock(return_value=delete_result)
        monkeypatch.setattr(server, "recipes_col", recipes)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/admin/recipes/dedup")

        assert resp.status_code == 200
        body = resp.json()
        assert body["details"][0]["kept"] == "legacy-soupe-id"
        server.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# BUG-031 — _RECEIPT_PROMPT (code mort dupliqué depuis ocr_service.py) supprimé
# ---------------------------------------------------------------------------

def test_dead_receipt_prompt_constant_removed():
    src = SERVER_SRC_PATH.read_text(encoding="utf-8")
    assert not re.search(r"^_RECEIPT_PROMPT\s*=", src, re.MULTILINE)
