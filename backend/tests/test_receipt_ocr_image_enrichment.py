"""Tests de non-régression — enrichissement image des articles issus de l'OCR ticket
de caisse (TODO.md : "implémentation end-to-end des images pour les articles issus
de l'analyse de ticket de caisse").

Couvre :
- product_catalog.search_openfoodfacts_by_name (recherche OFF par nom, cache)
- ocr_service._enrich_images (câblage best-effort dans ocr_receipt)
- server.py : products_cache_col transmis à ocr_receipt, image_url dans
  process_receipt_ticket (admin), bloc dashboard ocr_image_enrichment.
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


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class _FakeSearchClient:
    """Simule httpx.AsyncClient pour la recherche OFF par nom."""

    def __init__(self, response: _FakeResponse | None = None, exc: Exception | None = None):
        self._response = response
        self._exc = exc
        self.calls: list[dict] = []

    def __call__(self, *a, **k):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        self.calls.append({"url": url, "params": params})
        if self._exc:
            raise self._exc
        return self._response


# ---------------------------------------------------------------------------
# product_catalog.search_openfoodfacts_by_name
# ---------------------------------------------------------------------------

class TestSearchOpenFoodFactsByName:
    def test_empty_query_returns_none_without_http_call(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        result = asyncio.run(product_catalog.search_openfoodfacts_by_name("", None, col))
        assert result is None
        col.find_one.assert_not_awaited()

    def test_cache_hit_returns_cached_image_without_http_call(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value={"name_query": "lait demi-ecreme", "image_url": "https://example.com/lait.jpg"})
        fake_client = _FakeSearchClient()
        monkeypatch.setattr(product_catalog.httpx, "AsyncClient", fake_client)

        result = asyncio.run(product_catalog.search_openfoodfacts_by_name("Lait demi-écrémé", None, col))
        assert result == "https://example.com/lait.jpg"
        assert fake_client.calls == []

    def test_successful_search_returns_first_image_and_caches_it(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.update_one = AsyncMock()
        payload = {
            "products": [
                {"product_name": "", "image_url": "https://example.com/no-name.jpg"},
                {"product_name": "Lait demi-écrémé", "image_front_small_url": "https://example.com/lait-front.jpg", "image_url": "https://example.com/lait.jpg"},
            ]
        }
        fake_client = _FakeSearchClient(response=_FakeResponse(200, payload))
        monkeypatch.setattr(product_catalog.httpx, "AsyncClient", fake_client)

        result = asyncio.run(product_catalog.search_openfoodfacts_by_name("Lait demi-écrémé", "Lactel", col))
        # Le 1er produit sans product_name est ignoré ; le 2e a un nom valide.
        assert result == "https://example.com/lait-front.jpg"
        col.update_one.assert_awaited_once()

    def test_no_products_returns_none_and_caches_negative_result(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.update_one = AsyncMock()
        fake_client = _FakeSearchClient(response=_FakeResponse(200, {"products": []}))
        monkeypatch.setattr(product_catalog.httpx, "AsyncClient", fake_client)

        result = asyncio.run(product_catalog.search_openfoodfacts_by_name("Produit Inexistant Xyz", None, col))
        assert result is None
        col.update_one.assert_awaited_once()
        _, kwargs = col.update_one.call_args
        assert kwargs["upsert"] is True

    def test_network_failure_does_not_cache(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.update_one = AsyncMock()
        fake_client = _FakeSearchClient(exc=RuntimeError("network down"))
        monkeypatch.setattr(product_catalog.httpx, "AsyncClient", fake_client)

        result = asyncio.run(product_catalog.search_openfoodfacts_by_name("Yaourt nature", None, col))
        assert result is None
        col.update_one.assert_not_awaited()  # pas d'empoisonnement du cache (cf. E3 / lookup_product_openfoodfacts)

    def test_non_200_status_does_not_cache(self, monkeypatch):
        from backend import product_catalog

        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.update_one = AsyncMock()
        fake_client = _FakeSearchClient(response=_FakeResponse(503))
        monkeypatch.setattr(product_catalog.httpx, "AsyncClient", fake_client)

        result = asyncio.run(product_catalog.search_openfoodfacts_by_name("Pain de mie", None, col))
        assert result is None
        col.update_one.assert_not_awaited()


# ---------------------------------------------------------------------------
# ocr_service._enrich_images
# ---------------------------------------------------------------------------

class TestEnrichImages:
    def test_sets_image_url_when_search_succeeds(self, monkeypatch):
        from backend import ocr_service, product_catalog

        async def fake_search(name, brand, col):
            return f"https://example.com/{name}.jpg"

        monkeypatch.setattr(product_catalog, "search_openfoodfacts_by_name", fake_search)
        items = [{"normalized_title": "Lait", "brand": "Lactel", "image_url": None}]
        asyncio.run(ocr_service._enrich_images(MagicMock(), items))
        assert items[0]["image_url"] == "https://example.com/Lait.jpg"

    def test_skips_items_without_name(self, monkeypatch):
        from backend import ocr_service, product_catalog

        calls = []

        async def fake_search(name, brand, col):
            calls.append(name)
            return "https://example.com/x.jpg"

        monkeypatch.setattr(product_catalog, "search_openfoodfacts_by_name", fake_search)
        items = [{"normalized_title": "", "name": "", "image_url": None}]
        asyncio.run(ocr_service._enrich_images(MagicMock(), items))
        assert calls == []
        assert items[0]["image_url"] is None

    def test_one_item_failure_does_not_block_others(self, monkeypatch):
        from backend import ocr_service, product_catalog

        async def fake_search(name, brand, col):
            if name == "Boom":
                raise RuntimeError("OFF down")
            return "https://example.com/ok.jpg"

        monkeypatch.setattr(product_catalog, "search_openfoodfacts_by_name", fake_search)
        items = [
            {"normalized_title": "Boom", "image_url": None},
            {"normalized_title": "Yaourt", "image_url": None},
        ]
        asyncio.run(ocr_service._enrich_images(MagicMock(), items))
        assert items[0]["image_url"] is None
        assert items[1]["image_url"] == "https://example.com/ok.jpg"

    def test_no_image_found_leaves_image_url_none(self, monkeypatch):
        from backend import ocr_service, product_catalog

        async def fake_search(name, brand, col):
            return None

        monkeypatch.setattr(product_catalog, "search_openfoodfacts_by_name", fake_search)
        items = [{"normalized_title": "Produit Inconnu", "image_url": None}]
        asyncio.run(ocr_service._enrich_images(MagicMock(), items))
        assert items[0]["image_url"] is None


# ---------------------------------------------------------------------------
# server.py : products_cache_col transmis à ocr_receipt + images_found_count
# ---------------------------------------------------------------------------

class TestOcrReceiptRouteImageEnrichment:
    def test_ocr_receipt_route_passes_products_cache_col_and_tracks_images_found(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": "u1", "email": "u1@test.com"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        server.app.dependency_overrides[server.get_current_user] = lambda: current_user

        captured_kwargs = {}

        async def fake_ocr_receipt(**kwargs):
            captured_kwargs.update(kwargs)
            return {
                "purchase_date": "2026-08-18",
                "merchant": "Test",
                "currency": "EUR",
                "items": [
                    {"name": "Lait", "image_url": "https://example.com/lait.jpg"},
                    {"name": "Pain", "image_url": None},
                ],
                "ignored_items": [],
            }

        monkeypatch.setattr(server, "ocr_receipt", fake_ocr_receipt)
        monkeypatch.setattr(server, "ensure_external_allowed", lambda *a, **k: None)
        monkeypatch.setattr(server, "_enforce_feature_access", AsyncMock(return_value=MagicMock(plan_type="free")))
        monkeypatch.setattr(server, "consume_quota_or_raise", AsyncMock(return_value=None))
        monkeypatch.setattr(server, "track_service_usage", AsyncMock())
        tracked_events = []

        async def fake_track_business_event(**kwargs):
            tracked_events.append(kwargs)

        monkeypatch.setattr(server, "track_business_event", fake_track_business_event)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/ocr/receipt", json={"image": "aGVsbG8="})

        assert resp.status_code == 200
        assert captured_kwargs.get("products_cache_col") is server.products_cache_col
        succeeded_events = [e for e in tracked_events if e.get("event_name") == "ocr_scan_succeeded"]
        assert len(succeeded_events) == 1
        assert succeeded_events[0]["metadata_json"]["images_found_count"] == 1
        assert succeeded_events[0]["metadata_json"]["items_count"] == 2
        server.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# server.py : process_receipt_ticket (admin) enrichit l'image, plus de None figé
# ---------------------------------------------------------------------------

class TestProcessReceiptTicketImageEnrichment:
    def test_stock_docs_get_image_url_from_name_search(self, monkeypatch):
        server = _load_server(monkeypatch)
        admin = {"id": str(ObjectId()), "email": "admin@keepeat.test"}
        server.app.dependency_overrides[server._require_admin_user] = lambda: admin

        oid = ObjectId()
        tickets = MagicMock()
        tickets.find_one = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "pending"})
        tickets.find_one_and_update = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "processing"})
        tickets.update_one = AsyncMock()
        monkeypatch.setattr(server, "receipt_tickets_col", tickets)

        stock = MagicMock()
        stock.delete_many = AsyncMock()
        insert_res = MagicMock()
        insert_res.inserted_ids = [ObjectId()]
        stock.insert_many = AsyncMock(return_value=insert_res)
        monkeypatch.setattr(server, "stock_col", stock)

        async def fake_search(name, brand, col):
            return "https://example.com/found.jpg" if name == "Yaourt nature" else None

        monkeypatch.setattr(server, "search_openfoodfacts_by_name", fake_search)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post(
            f"/api/admin/receipt-tickets/{oid}/process",
            json={"items": [{"name": "Yaourt nature"}], "note": ""},
        )
        assert resp.status_code == 200
        inserted_docs = stock.insert_many.call_args.args[0]
        assert inserted_docs[0]["image_url"] == "https://example.com/found.jpg"
        server.app.dependency_overrides.clear()

    def test_image_search_failure_falls_back_to_none_without_breaking_insert(self, monkeypatch):
        server = _load_server(monkeypatch)
        admin = {"id": str(ObjectId()), "email": "admin@keepeat.test"}
        server.app.dependency_overrides[server._require_admin_user] = lambda: admin

        oid = ObjectId()
        tickets = MagicMock()
        tickets.find_one = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "pending"})
        tickets.find_one_and_update = AsyncMock(return_value={"_id": oid, "user_id": "u1", "status": "processing"})
        tickets.update_one = AsyncMock()
        monkeypatch.setattr(server, "receipt_tickets_col", tickets)

        stock = MagicMock()
        stock.delete_many = AsyncMock()
        insert_res = MagicMock()
        insert_res.inserted_ids = [ObjectId()]
        stock.insert_many = AsyncMock(return_value=insert_res)
        monkeypatch.setattr(server, "stock_col", stock)

        async def failing_search(name, brand, col):
            raise RuntimeError("OFF down")

        monkeypatch.setattr(server, "search_openfoodfacts_by_name", failing_search)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post(
            f"/api/admin/receipt-tickets/{oid}/process",
            json={"items": [{"name": "Article X"}], "note": ""},
        )
        assert resp.status_code == 200
        inserted_docs = stock.insert_many.call_args.args[0]
        assert inserted_docs[0]["image_url"] is None
        server.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# server.py : bloc dashboard ocr_image_enrichment
# ---------------------------------------------------------------------------

class TestOcrImageEnrichmentDashboardBlock:
    def test_dashboard_includes_ocr_image_enrichment_stats(self, monkeypatch):
        server = _load_server(monkeypatch)
        admin = {"id": str(ObjectId()), "email": "admin@keepeat.test"}
        server.app.dependency_overrides[server._require_admin_user] = lambda: admin

        events_col = MagicMock()

        class _FakeCursor:
            def __init__(self, rows):
                self._rows = rows

            async def to_list(self, length=None):
                return self._rows

        rows = [
            {"metadata_json": {"items_count": 3, "images_found_count": 2}},
            {"metadata_json": {"items_count": 5, "images_found_count": 1}},
        ]
        events_col.find = MagicMock(return_value=_FakeCursor(rows))
        monkeypatch.setattr(server, "business_events_col", events_col)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/admin/monitoring/dashboard")
        assert resp.status_code == 200
        block = resp.json()["ocr_image_enrichment"]
        assert block["scans_count"] == 2
        assert block["items_total"] == 8
        assert block["images_found_count"] == 3
        assert block["images_found_rate"] == round(3 / 8, 4)
        server.app.dependency_overrides.clear()
