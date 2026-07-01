"""Tests de non-régression — bugs ÉLEVÉS de l'audit système (E1, E2, E3, E5).

- E1 : login renvoie 401 (jamais 500/KeyError) si le document n'a pas la clé
       exacte `hashed_password` ; le seed de test écrit bien `hashed_password`.
- E2 : la clé Gemini n'est jamais dans l'URL (query-string) — passée en header.
- E3 : product_catalog ne met PAS en cache un échec réseau (pas d'empoisonnement) ;
       _extract_gemini_recipe_text est défensif (réponse vide/bloquée → None).
- E5 : process_receipt_ticket est idempotent (2ᵉ appel → 409, pas de duplication)
       et insère via insert_many (une seule opération).
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


# ---------------------------------------------------------------------------
# E1 — login robuste (pas de KeyError → 500)
# ---------------------------------------------------------------------------

class TestLoginHashedPasswordMissing:
    def test_login_missing_hashed_password_returns_401_not_500(self, monkeypatch):
        server = _load_server(monkeypatch)
        users_col = MagicMock()
        # Document sans la clé `hashed_password` (schéma divergent / ancien import).
        users_col.find_one = AsyncMock(return_value={"_id": ObjectId(), "email": "x@example.com"})
        users_col.update_one = AsyncMock()
        monkeypatch.setattr(server, "users_col", users_col)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/auth/login", json={"email": "x@example.com", "password": "whatever"})
        assert resp.status_code == 401  # surtout pas 500


def test_seed_uses_hashed_password_key():
    """Le seed de test doit écrire la clé `hashed_password` (pas `password_hash`)."""
    src = (BACKEND_DIR / "server.py").read_text(encoding="utf-8")
    seed_start = src.index("async def test_seed_data")
    seed_block = src[seed_start:seed_start + 1500]
    assert '"password_hash"' not in seed_block, "le seed ne doit plus écrire la clé password_hash"
    assert seed_block.count('"hashed_password"') >= 2


# ---------------------------------------------------------------------------
# E2 — clé Gemini jamais en query-string
# ---------------------------------------------------------------------------

class TestGeminiKeyNotInUrl:
    def test_build_url_has_no_key_query_param(self, monkeypatch):
        server = _load_server(monkeypatch)
        url = server._build_gemini_generate_content_url(model="gemini-2.0-flash-lite")
        assert "key=" not in url
        assert url.endswith(":generateContent")

    def test_recipes_service_sends_key_header_not_query(self, monkeypatch):
        from backend import recipes_service

        captured = {}

        class _FakeResp:
            status_code = 200
            def json(self):
                return {"candidates": [{"content": {"parts": [{"text": '{"title":"Tarte","ingredients_keywords":["pomme"]}'}]}}]}

        class _FakeClient:
            def __init__(self, *a, **k):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False
            async def post(self, url, headers=None, json=None):
                captured["url"] = url
                captured["headers"] = headers or {}
                return _FakeResp()

        monkeypatch.setattr(recipes_service.httpx, "AsyncClient", _FakeClient)
        result = asyncio.run(recipes_service._generate_ai_recipe(["pomme"], "SECRET_KEY"))
        assert result is not None
        assert "key=" not in captured["url"]
        assert captured["headers"].get("x-goog-api-key") == "SECRET_KEY"


# ---------------------------------------------------------------------------
# E3 — résilience
# ---------------------------------------------------------------------------

class TestProductCatalogCacheNoPoisoning:
    def test_network_failure_does_not_write_cache(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.update_one = AsyncMock()

        class _FailingClient:
            def __init__(self, *a, **k):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False
            async def get(self, url):
                raise RuntimeError("network down")

        monkeypatch.setattr(product_catalog.httpx, "AsyncClient", _FailingClient)
        result = asyncio.run(product_catalog.lookup_product_openfoodfacts("123", col))
        assert result is None
        col.update_one.assert_not_awaited()  # pas d'empoisonnement du cache

    def test_definitive_not_found_is_cached(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.update_one = AsyncMock()

        class _Resp:
            status_code = 200
            def json(self):
                return {"status": 0}  # OFF : produit définitivement absent

        class _Client:
            def __init__(self, *a, **k):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False
            async def get(self, url):
                return _Resp()

        monkeypatch.setattr(product_catalog.httpx, "AsyncClient", _Client)
        asyncio.run(product_catalog.lookup_product_openfoodfacts("123", col))
        col.update_one.assert_awaited_once()  # résultat concluant → mis en cache


class TestGeminiRecipeTextExtraction:
    def test_empty_candidates_returns_none(self, monkeypatch):
        from backend import recipes_service
        assert recipes_service._extract_gemini_recipe_text({"candidates": []}) is None

    def test_block_reason_returns_none(self, monkeypatch):
        from backend import recipes_service
        assert recipes_service._extract_gemini_recipe_text({"promptFeedback": {"blockReason": "SAFETY"}}) is None

    def test_valid_payload_returns_text(self, monkeypatch):
        from backend import recipes_service
        payload = {"candidates": [{"content": {"parts": [{"text": "  hello  "}]}}]}
        assert recipes_service._extract_gemini_recipe_text(payload) == "hello"

    def test_malformed_payload_returns_none(self, monkeypatch):
        from backend import recipes_service
        assert recipes_service._extract_gemini_recipe_text({"candidates": [None]}) is None


# ---------------------------------------------------------------------------
# E5 — process_receipt_ticket atomique et idempotent
# ---------------------------------------------------------------------------

class TestReceiptTicketIdempotency:
    def _setup_admin(self, server, monkeypatch):
        admin = {"id": str(ObjectId()), "email": "admin@keepeat.test"}
        server.app.dependency_overrides[server._require_admin_user] = lambda: admin

    def test_first_call_uses_insert_many_once(self, monkeypatch):
        server = _load_server(monkeypatch)
        self._setup_admin(server, monkeypatch)
        oid = ObjectId()

        tickets = MagicMock()
        tickets.find_one = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "pending"})
        tickets.find_one_and_update = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "processing"})
        tickets.update_one = AsyncMock()
        monkeypatch.setattr(server, "receipt_tickets_col", tickets)

        stock = MagicMock()
        stock.delete_many = AsyncMock()
        insert_res = MagicMock()
        insert_res.inserted_ids = [ObjectId(), ObjectId()]
        stock.insert_many = AsyncMock(return_value=insert_res)
        stock.insert_one = AsyncMock()  # ne doit PAS être utilisé
        monkeypatch.setattr(server, "stock_col", stock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post(
            f"/api/admin/receipt-tickets/{oid}/process",
            json={"items": [{"name": "Lait"}, {"name": "Pain"}], "note": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["items_added"] == 2
        stock.insert_many.assert_awaited_once()
        stock.insert_one.assert_not_awaited()
        server.app.dependency_overrides.clear()

    def test_already_processed_returns_409_without_inserting(self, monkeypatch):
        server = _load_server(monkeypatch)
        self._setup_admin(server, monkeypatch)
        oid = ObjectId()

        tickets = MagicMock()
        tickets.find_one = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "processed"})
        # Revendication atomique échoue (déjà processed) → None.
        tickets.find_one_and_update = AsyncMock(return_value=None)
        tickets.update_one = AsyncMock()
        monkeypatch.setattr(server, "receipt_tickets_col", tickets)

        stock = MagicMock()
        stock.delete_many = AsyncMock()
        stock.insert_many = AsyncMock()
        monkeypatch.setattr(server, "stock_col", stock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post(
            f"/api/admin/receipt-tickets/{oid}/process",
            json={"items": [{"name": "Lait"}], "note": ""},
        )
        assert resp.status_code == 409
        stock.insert_many.assert_not_awaited()  # pas de duplication
        server.app.dependency_overrides.clear()
