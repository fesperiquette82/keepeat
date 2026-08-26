import asyncio
import importlib
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))


class FakeFoodDefaultsCol:
    def __init__(self, seed=None):
        self.docs = {k: dict(v) for k, v in (seed or {}).items()}

    async def find_one(self, query):
        doc = self.docs.get(query.get("key"))
        return dict(doc) if doc is not None else None

    async def update_one(self, query, update, upsert=False):
        key = query.get("key")
        is_new = key not in self.docs
        if is_new:
            if not upsert:
                return None
            self.docs[key] = {"key": key}
        doc = self.docs[key]
        for k, v in update.get("$set", {}).items():
            doc[k] = v
        for k, v in update.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + v
        if is_new:
            for k, v in update.get("$setOnInsert", {}).items():
                doc.setdefault(k, v)
        return None


class FakeServiceUsageLogsCol:
    async def insert_one(self, _doc):
        return None

    async def count_documents(self, _query):
        return 0


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    if "server" in sys.modules:
        del sys.modules["server"]
    return importlib.import_module("server")


def test_resolve_stock_food_category_prefers_valid_client_value(monkeypatch):
    server = _load_server(monkeypatch)

    item = server.StockItemCreate(name="Yaourt nature", category="autres", food_category="frais")

    assert server._resolve_stock_food_category(item) == "frais"


def test_resolve_stock_food_category_falls_back_to_inference(monkeypatch):
    server = _load_server(monkeypatch)

    item = server.StockItemCreate(name="Lait demi-écrémé", category="autres", food_category="")

    assert server._resolve_stock_food_category(item) == "frais"


def test_resolve_stock_storage_zone_prefers_explicit_zone_then_food_category(monkeypatch):
    server = _load_server(monkeypatch)

    explicit_zone_item = server.StockItemCreate(name="Poulet", storageZone="congelateur", food_category="proteines")
    inferred_zone_item = server.StockItemCreate(name="Riz basmati", food_category="feculents")

    assert server._resolve_stock_storage_zone(explicit_zone_item, "proteines") == "congelateur"
    assert server._resolve_stock_storage_zone(inferred_zone_item, "feculents") == "placard"


def test_apply_food_defaults_fallback_fills_missing_zone_and_expiry_from_cache(monkeypatch):
    server = _load_server(monkeypatch)
    server.food_defaults_col = FakeFoodDefaultsCol(seed={
        "chips pomme de terre truffe": {
            "key": "chips pomme de terre truffe",
            "storage_zone": "placard",
            "shelf_life_days": {"fridge": None, "pantry": 180, "freezer": None},
        }
    })
    server.service_usage_logs_col = FakeServiceUsageLogsCol()

    zone, expiry = asyncio.run(server._apply_food_defaults_fallback(
        name="Chips pomme de terre truffe",
        food_category="epicerie",
        storage_zone=None,
        expiry_date=None,
    ))

    assert zone == "placard"
    assert expiry is not None


def test_apply_food_defaults_fallback_never_overwrites_known_values(monkeypatch):
    server = _load_server(monkeypatch)

    class RaisingCol:
        async def find_one(self, _query):
            raise AssertionError("le cache ne doit pas être consulté quand tout est déjà connu")

    server.food_defaults_col = RaisingCol()
    server.service_usage_logs_col = FakeServiceUsageLogsCol()

    zone, expiry = asyncio.run(server._apply_food_defaults_fallback(
        name="Yaourt nature",
        food_category="frais",
        storage_zone="frigo",
        expiry_date="2026-05-01",
    ))

    assert zone == "frigo"
    assert expiry == "2026-05-01"


def test_apply_food_defaults_fallback_returns_unchanged_on_total_cache_miss(monkeypatch):
    server = _load_server(monkeypatch)
    monkeypatch.delenv("GEMINI_FOOD_DEFAULTS_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_OCR_API_KEY", raising=False)
    server.food_defaults_col = FakeFoodDefaultsCol()
    server.service_usage_logs_col = FakeServiceUsageLogsCol()

    zone, expiry = asyncio.run(server._apply_food_defaults_fallback(
        name="Produit totalement inconnu",
        food_category="autres",
        storage_zone=None,
        expiry_date=None,
    ))

    assert zone is None
    assert expiry is None


def test_get_product_uses_food_defaults_when_shelf_life_is_generic(monkeypatch):
    server = _load_server(monkeypatch)
    server.food_defaults_col = FakeFoodDefaultsCol(seed={
        "chips pomme de terre truffe": {
            "key": "chips pomme de terre truffe",
            "storage_zone": "placard",
            "shelf_life_days": {"fridge": None, "pantry": 180, "freezer": None},
        }
    })
    server.service_usage_logs_col = FakeServiceUsageLogsCol()

    async def _fake_lookup(barcode, products_cache_col):
        return server.ProductBase(barcode=barcode, name="Chips pomme de terre truffe")

    monkeypatch.setattr(server, "lookup_product_openfoodfacts", _fake_lookup)

    response = asyncio.run(server.get_product(barcode="1234567890123", current_user={"id": "user-1"}))

    assert response.shelf_life.pantry_days == 180
    assert response.shelf_life.refrigerator_days is None


def test_get_product_keeps_keyword_match_without_consulting_food_defaults(monkeypatch):
    server = _load_server(monkeypatch)

    class RaisingCol:
        async def find_one(self, _query):
            raise AssertionError("food_defaults ne doit pas être consulté quand un mot-clé a matché")

    server.food_defaults_col = RaisingCol()
    server.service_usage_logs_col = FakeServiceUsageLogsCol()

    async def _fake_lookup(barcode, products_cache_col):
        # SHELF_LIFE_BY_KEYWORD (product_catalog.py) matche sur des mots-clés
        # anglais ("milk") — un nom français comme "Lait demi-écrémé" ne
        # matcherait justement PAS et retomberait sur le générique.
        return server.ProductBase(barcode=barcode, name="Whole Milk 1L")

    monkeypatch.setattr(server, "lookup_product_openfoodfacts", _fake_lookup)

    response = asyncio.run(server.get_product(barcode="1234567890123", current_user={"id": "user-1"}))

    assert response.shelf_life.category_fr == "Produits laitiers"
    assert response.shelf_life.refrigerator_days == 7
