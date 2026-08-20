import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock

from starlette.responses import Response

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))


ALLOWED_UNITS = {
    "piece", "g", "kg", "ml", "cl", "l", "tsp", "tbsp", "pinch", "pot", "jar", "can", "slice",
}


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


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    if "server" in sys.modules:
        del sys.modules["server"]
    return importlib.import_module("server")


def test_score_recipe_match_returns_structured_ingredients_and_legacy_fields(monkeypatch):
    server = _load_server(monkeypatch)

    recipe_doc = {
        "id": "r-1",
        "title": "Omelette",
        "description": "Simple",
        "servings": 4,
        "ingredients": [
            {"name": "oeufs", "quantity": "4 piece", "optional": False},
            {"name": "Riz", "quantity": "150 g", "optional": False},
            {"name": "Olives", "quantity": "", "optional": True},
        ],
    }
    stock_items = [
        {"_id": "stock-1", "name": "oeufs"},
        {"_id": "stock-2", "name": "riz"},
    ]

    scored = server._score_recipe_match(recipe_doc, stock_items)

    assert scored["servings"] == 4
    assert "available_ingredients" in scored
    assert "missing_ingredients" in scored
    assert "ingredients" in scored
    assert len(scored["ingredients"]) == 3

    egg = next(item for item in scored["ingredients"] if "oeuf" in server._normalize_ingredient_name(item["name"]))
    assert egg["quantity"] == 4.0
    assert egg["unit"] == "piece"
    assert egg["available"] is True
    assert egg["matched_stock_item_ids"] == ["stock-1"]

    rice = next(item for item in scored["ingredients"] if server._normalize_ingredient_name(item["name"]) == "riz")
    assert rice["quantity"] == 150.0
    assert rice["unit"] == "g"
    assert rice["available"] is True

    olives = next(item for item in scored["ingredients"] if "olive" in server._normalize_ingredient_name(item["name"]))
    assert olives["available"] is False
    assert olives["optional"] is True
    assert olives["is_estimated"] is True

    for ingredient in scored["ingredients"]:
        if ingredient["unit"] is not None:
            assert ingredient["unit"] in ALLOWED_UNITS
        assert "name" in ingredient
        assert "quantity" in ingredient
        assert "unit" in ingredient


def test_recipes_suggestions_endpoint_includes_structured_ingredients(monkeypatch):
    server = _load_server(monkeypatch)

    async def fake_fetch_stock_candidates(*, scope_ids, filter_value):
        return [{"_id": "stock-egg", "name": "oeufs"}]

    recipe_docs = [
        {
            "id": "recipe-1",
            "title": "Œufs brouillés",
            "description": "Idée simple",
            "servings": 2,
            "duration_min": 10,
            "ingredients": [
                {"name": "oeufs", "quantity": "2 piece", "optional": False},
                {"name": "huile d'olive", "quantity": "1 tbsp", "optional": False},
            ],
            "steps": ["Battre", "Cuire"],
        }
    ]

    monkeypatch.setattr(server, "_fetch_stock_candidates", fake_fetch_stock_candidates)
    monkeypatch.setattr(server, "recipes_col", _FakeRecipesCollection(recipe_docs))
    monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: None)
    # Le quota "recettes suggérées" (partagé catalogue + IA) est désormais consommé
    # dès qu'une recette du catalogue est effectivement retournée — hors périmètre
    # de ce test de contrat sur la structure de la réponse.
    monkeypatch.setattr(
        server,
        "_enforce_feature_access",
        AsyncMock(return_value={"plan": "free", "policy": {"allowed": True, "monthly_limit": 8}, "quota": None}),
    )

    payload = asyncio.run(
        server.get_recipe_suggestions(
            response=Response(),
            recipe_filter="urgent",
            include_meta=False,
            suggestion_style="classique",
            locale=None,
            accept_language=None,
            current_user={"id": "user-1"},
        )
    )

    assert isinstance(payload, list)
    assert len(payload) == 1
    recipe = payload[0]
    assert recipe["servings"] == 2
    assert isinstance(recipe["ingredients"], list)
    assert recipe["ingredients"][0]["name"]
    assert "available_ingredients" in recipe
    assert "missing_ingredients" in recipe
