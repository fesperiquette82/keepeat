import importlib
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))


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
