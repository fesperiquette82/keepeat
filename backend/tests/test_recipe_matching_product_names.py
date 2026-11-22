"""BUG-103 : les recettes du catalogue n'étaient proposées qu'aux produits nommés
exactement comme l'ingrédient.

Le serveur comparait le nom normalisé du produit au nom normalisé de
l'ingrédient : « Carottes » correspondait à « carotte », « Carottes râpées bio
500g » jamais. Or les noms du stock sont des noms de produits (ticket de
caisse, code-barres, saisie libre). Pour un stock réel, le catalogue de 303
recettes ne trouvait rien et l'écran retombait sur une recette générée par
l'IA, ou sur rien.
"""
import asyncio
import importlib
import sys
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from starlette.responses import Response

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

from backend.ingredient_keys import ingredient_key, stock_item_keys  # noqa: E402


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


def _recipe(recipe_id, title, required, optional=()):
    return {
        "id": recipe_id,
        "title": title,
        "description": "",
        "servings": 2,
        "duration_min": 25,
        "ingredients": [{"name": name, "quantity": "", "optional": False} for name in required]
        + [{"name": name, "quantity": "", "optional": True} for name in optional],
        "steps": ["Préparer."],
    }


def _ingredient(scored, name):
    return next(item for item in scored["ingredients"] if item["name"] == name)


# --- Clés : un produit fournit les ingrédients par lesquels son nom commence ---

@pytest.mark.parametrize(
    ("product", "provides"),
    [
        ("Carottes râpées bio 500g", "carotte"),
        ("Lait demi-écrémé Lactel 1L", "lait"),
        ("Pâtes complètes Barilla 500g", "pate"),
        ("Tomates cerises 250g", "tomate"),
        ("Tomates cerises 250g", "tomate cerise"),
        ("Œufs frais x12", "oeuf"),
        ("Oeufs plein air x6", "oeuf"),
        ("Crème fraîche épaisse 30%", "creme fraiche"),
        ("Crème fraîche épaisse 30%", "creme"),
        ("Fromage râpé", "fromage"),
        ("Pommes de terre grenaille", "pomme de terre"),
        ("Huile d'olive vierge extra", "huile d olive"),
        ("Pommes Golden", "pomme"),
        ("Carottes", "carotte"),
    ],
)
def test_un_produit_fournit_les_ingredients_qui_commencent_son_nom(product, provides):
    assert provides in stock_item_keys(product)


@pytest.mark.parametrize(
    ("product", "not_provided"),
    [
        ("Pommes de terre grenaille", "pomme"),
        ("Beurre de cacahuète", "beurre"),
        ("Pâte à tartiner noisettes", "pate"),
        ("Lait de coco", "lait"),
        ("Riz au lait", "riz"),
        ("Huile d'olive vierge extra", "huile"),
        ("Crème dessert chocolat", "creme"),
        ("Fromage blanc 0%", "fromage"),
        ("Fromage frais nature", "fromage"),
        ("Lait concentré sucré", "lait"),
        ("Selle d'agneau", "sel"),
        ("Aile de poulet", "ail"),
        ("Nouilles chinoises aux oeufs", "oeuf"),
        ("Sauce tomate", "tomate"),
    ],
)
def test_les_faux_amis_ne_fournissent_pas_l_ingredient(product, not_provided):
    assert not_provided not in stock_item_keys(product)


def test_l_ingredient_se_normalise_comme_le_produit():
    assert ingredient_key("Carottes") == ingredient_key("carotte") == "carotte"
    assert ingredient_key("Pommes de terre") == "pomme de terre"
    assert ingredient_key("huile d'olive") == "huile d olive"
    assert ingredient_key("œufs") == ingredient_key("Oeufs") == "oeuf"


# --- Score d'une recette contre le stock ------------------------------------------

def test_bug_103_un_produit_au_nom_commercial_rend_l_ingredient_disponible(monkeypatch):
    server = _load_server(monkeypatch)
    recipe = _recipe("fr_puree_carottes", "Purée de carottes", ["carottes", "beurre"])
    stock = [
        {"_id": "s-carottes", "name": "Carottes râpées bio 500g"},
        {"_id": "s-beurre", "name": "Beurre doux Président 250g"},
    ]

    scored = server._score_recipe_match(recipe, stock)

    assert scored["available_count"] == 2
    assert scored["missing_count"] == 0
    assert _ingredient(scored, "carottes")["matched_stock_item_ids"] == ["s-carottes"]
    assert _ingredient(scored, "beurre")["matched_stock_item_ids"] == ["s-beurre"]
    assert _ingredient(scored, "beurre")["available"] is True


def test_un_faux_ami_ne_rend_pas_l_ingredient_disponible(monkeypatch):
    server = _load_server(monkeypatch)
    recipe = _recipe("compote", "Compote de pommes", ["pommes", "sucre"])
    stock = [{"_id": "s-pdt", "name": "Pommes de terre grenaille"}]

    assert server._score_recipe_match(recipe, stock) == {}


def test_les_correspondances_exactes_d_origine_sont_conservees(monkeypatch):
    server = _load_server(monkeypatch)
    recipe = _recipe("omelette", "Omelette", ["oeufs", "haricots verts"])
    stock = [{"_id": "s-1", "name": "oeufs"}, {"_id": "s-2", "name": "Haricots verts"}]

    scored = server._score_recipe_match(recipe, stock)

    assert scored["available_count"] == 2
    assert _ingredient(scored, "oeufs")["matched_stock_item_ids"] == ["s-1"]
    assert _ingredient(scored, "haricots verts")["matched_stock_item_ids"] == ["s-2"]


def test_un_produit_urgent_au_nom_commercial_compte_comme_urgent(monkeypatch):
    server = _load_server(monkeypatch)
    recipe = _recipe("puree", "Purée", ["carottes"])
    tomorrow = server.utc_now() + timedelta(days=1)
    later = server.utc_now() + timedelta(days=20)

    urgent = server._score_recipe_match(recipe, [{"_id": "s", "name": "Carottes râpées", "_expiry_dt": tomorrow}])
    not_urgent = server._score_recipe_match(recipe, [{"_id": "s", "name": "Carottes râpées", "_expiry_dt": later}])

    assert urgent["score"] - not_urgent["score"] == 5


def test_tous_les_articles_qui_fournissent_l_ingredient_sont_associes(monkeypatch):
    server = _load_server(monkeypatch)
    recipe = _recipe("salade", "Salade", ["tomates"])
    stock = [
        {"_id": "s-1", "name": "Tomates cerises 250g"},
        {"_id": "s-2", "name": "Sauce tomate"},
        {"_id": "s-3", "name": "Tomates"},
    ]

    scored = server._score_recipe_match(recipe, stock)

    assert _ingredient(scored, "tomates")["matched_stock_item_ids"] == ["s-1", "s-3"]


def test_la_regle_du_signalement_est_celle_du_score(monkeypatch):
    server = _load_server(monkeypatch)
    pairs = [
        ("Carottes râpées bio 500g", "carottes", True),
        ("tomate", "tomate", True),
        ("Pommes de terre grenaille", "pommes", False),
        ("Beurre de cacahuète", "beurre", False),
        ("Quinoa gourmand 400g", "semoule", False),
    ]
    for stock_name, ingredient_name, expected in pairs:
        scored = server._score_recipe_match(_recipe("r", "R", [ingredient_name]), [{"_id": "s", "name": stock_name}])
        assert bool(scored) is expected, (stock_name, ingredient_name)
        assert server._stock_name_provides_ingredient(stock_name, ingredient_name) is expected, (stock_name, ingredient_name)


# --- Bout en bout : l'écran reçoit des recettes du catalogue -----------------------

def _call_suggestions(server, monkeypatch, stock, recipe_docs):
    async def fake_fetch_stock_candidates(*, scope_ids, filter_value):
        return stock

    monkeypatch.setattr(server, "_fetch_stock_candidates", fake_fetch_stock_candidates)
    monkeypatch.setattr(server, "recipes_col", _FakeRecipesCollection(recipe_docs))
    monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: None)
    monkeypatch.setattr(
        server,
        "_enforce_feature_access",
        AsyncMock(return_value={"plan": "free", "policy": {"allowed": True, "monthly_limit": 8}, "quota": None}),
    )
    upsert_gap = AsyncMock(return_value=False)
    monkeypatch.setattr(server, "_upsert_recipe_gap", upsert_gap)
    payload = asyncio.run(
        server.get_recipe_suggestions(
            response=Response(),
            recipe_filter="stock",
            include_meta=False,
            suggestion_style="classique",
            locale=None,
            accept_language=None,
            current_user={"id": "user-1"},
        )
    )
    return payload, upsert_gap


def test_bug_103_un_stock_reel_recoit_les_recettes_du_catalogue(monkeypatch):
    server = _load_server(monkeypatch)
    stock = [
        {"_id": "s-carottes", "name": "Carottes râpées bio 500g"},
        {"_id": "s-lait", "name": "Lait demi-écrémé Lactel 1L"},
        {"_id": "s-oeufs", "name": "Oeufs plein air x6"},
    ]
    recipe_docs = [
        _recipe("fr_puree_carottes", "Purée de carottes", ["carottes", "beurre"]),
        _recipe("fr_crepes", "Crêpes", ["oeufs", "lait", "farine"]),
        _recipe("fr_gratin", "Gratin dauphinois", ["pommes de terre", "creme"]),
    ]

    payload, upsert_gap = _call_suggestions(server, monkeypatch, stock, recipe_docs)

    assert sorted(recipe["id"] for recipe in payload) == ["fr_crepes", "fr_puree_carottes"]
    crepes = next(recipe for recipe in payload if recipe["id"] == "fr_crepes")
    assert crepes["available_count"] == 2
    assert crepes["missing_ingredients"] == ["farine"]
    upsert_gap.assert_not_awaited()


def test_bug_103_le_signalement_ne_liste_que_les_articles_non_couverts(monkeypatch):
    server = _load_server(monkeypatch)
    # Une seule recette candidate, qui manque de trop d'ingrédients pour être
    # proposée : un signalement est fait, avec les articles qu'elle ne couvre pas.
    stock = [
        {"_id": "s-carottes", "name": "Carottes râpées bio 500g"},
        {"_id": "s-quinoa", "name": "Quinoa gourmand 400g"},
    ]
    recipe_docs = [_recipe("fr_couscous", "Couscous", ["carottes", "semoule", "pois chiches", "navets", "courgettes"])]

    payload, upsert_gap = _call_suggestions(server, monkeypatch, stock, recipe_docs)

    assert payload == []
    upsert_gap.assert_awaited_once()
    assert upsert_gap.await_args.kwargs["uncovered_ingredients"] == ["quinoa gourmand 400g"]
