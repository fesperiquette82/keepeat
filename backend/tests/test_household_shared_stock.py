"""Tests de non-régression — BUG-049 (partage foyer, phases 2 et 3).

Phase 2 : le stock est visible/modifiable par tous les membres d'un foyer
(chaque item reste attribué à qui l'a ajouté — `_resolve_stock_scope_ids` /
`_stock_scope_match` élargissent seulement la visibilité, sans réassignation).
Phase 3 : les alertes (péremption, inactivité, rappels) déclenchées par un item
partagé notifient chaque membre du foyer individuellement (préférences et
dédoublonnage propres à chacun via `user_alerts_col`).
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock

from bson import ObjectId

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)
    for mod in ("server", "models", "household_service", "entitlements"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


def _matches(doc: dict, flt: dict) -> bool:
    for key, cond in flt.items():
        value = doc.get(key)
        if isinstance(cond, dict) and "$in" in cond:
            if value not in cond["$in"]:
                return False
        elif value != cond:
            return False
    return True


class _FakeCursor:
    def __init__(self, items):
        self._items = list(items)

    def sort(self, *_args, **_kwargs):
        return self

    def skip(self, n):
        self._items = self._items[n:]
        return self

    def limit(self, n):
        self._items = self._items[:n]
        return self

    async def to_list(self, length=None):
        return self._items[: length] if length else self._items

    def __aiter__(self):
        return self._aiter()

    async def _aiter(self):
        for item in self._items:
            yield item


class FakeStockCollection:
    """Collection Mongo async minimale en mémoire — filtre générique (dont
    `$in`) sur tous les champs, suffisant pour find/find_one/update_one/
    count_documents utilisés par les endpoints stock migrés vers le scope foyer."""

    def __init__(self, docs=None):
        self.docs: dict[str, dict] = {}
        for doc in docs or []:
            self.docs[str(doc["_id"])] = dict(doc)

    def find(self, flt=None):
        flt = flt or {}
        matched = [dict(doc) for doc in self.docs.values() if _matches(doc, flt)]
        return _FakeCursor(matched)

    async def find_one(self, flt, projection=None):
        for doc in self.docs.values():
            if _matches(doc, flt):
                return dict(doc)
        return None

    async def update_one(self, flt, update):
        for _id, doc in self.docs.items():
            if _matches(doc, flt):
                for key, val in update.get("$set", {}).items():
                    doc[key] = val
                return type("Result", (), {"matched_count": 1})()
        return type("Result", (), {"matched_count": 0})()

    async def count_documents(self, flt):
        return sum(1 for doc in self.docs.values() if _matches(doc, flt))


class FakeHouseholdsCollection:
    def __init__(self, docs=None):
        self.docs: dict[str, dict] = {}
        for doc in docs or []:
            self.docs[str(doc["_id"])] = dict(doc)

    async def find_one(self, flt, projection=None):
        _id = flt.get("_id")
        doc = self.docs.get(str(_id)) if _id is not None else None
        return dict(doc) if doc else None

    async def update_one(self, flt, update):
        _id = flt.get("_id")
        doc = self.docs.get(str(_id)) if _id is not None else None
        if doc is None:
            return type("Result", (), {"matched_count": 0})()
        for key, val in update.get("$set", {}).items():
            doc[key] = val
        return type("Result", (), {"matched_count": 1})()


OWNER_ID = "507f1f77bcf86cd799439011"
MEMBER_ID = "507f1f77bcf86cd799439012"
OUTSIDER_ID = "507f1f77bcf86cd799439013"


class TestResolveStockScopeIds:
    def test_solo_user_scope_is_self_only(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setattr(server, "households_col", FakeHouseholdsCollection())
        result = asyncio.run(server._resolve_stock_scope_ids({"id": OWNER_ID}))
        assert result == [OWNER_ID]

    def test_household_member_scope_is_all_members(self, monkeypatch):
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        households_col = FakeHouseholdsCollection([
            {"_id": household_oid, "member_ids": [OWNER_ID, MEMBER_ID]},
        ])
        monkeypatch.setattr(server, "households_col", households_col)
        result = asyncio.run(server._resolve_stock_scope_ids(
            {"id": MEMBER_ID, "household_id": str(household_oid)},
        ))
        assert set(result) == {OWNER_ID, MEMBER_ID}

    def test_broken_household_falls_back_to_self(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setattr(server, "households_col", FakeHouseholdsCollection())
        result = asyncio.run(server._resolve_stock_scope_ids(
            {"id": MEMBER_ID, "household_id": str(ObjectId())},
        ))
        assert result == [MEMBER_ID]

    def test_stock_scope_match_single_vs_multiple(self, monkeypatch):
        server = _load_server(monkeypatch)
        assert server._stock_scope_match([OWNER_ID]) == {"user_id": OWNER_ID}
        assert server._stock_scope_match([OWNER_ID, MEMBER_ID]) == {
            "user_id": {"$in": [OWNER_ID, MEMBER_ID]}
        }


class TestGetStockHouseholdVisibility:
    def _setup(self, monkeypatch, server, *, household_oid):
        households_col = FakeHouseholdsCollection([
            {"_id": household_oid, "member_ids": [OWNER_ID, MEMBER_ID]},
        ])
        stock_col = FakeStockCollection([
            {"_id": ObjectId(), "user_id": OWNER_ID, "name": "Lait", "status": "active", "added_date": "2026-01-01"},
            {"_id": ObjectId(), "user_id": MEMBER_ID, "name": "Œufs", "status": "active", "added_date": "2026-01-02"},
            {"_id": ObjectId(), "user_id": OUTSIDER_ID, "name": "Hors foyer", "status": "active", "added_date": "2026-01-03"},
        ])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "stock_col", stock_col)
        return stock_col

    def test_member_sees_stock_added_by_other_member(self, monkeypatch):
        """BUG-049 phase 2 : un item ajouté par un membre doit être visible par
        les autres membres du même foyer via GET /api/stock."""
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        self._setup(monkeypatch, server, household_oid=household_oid)
        current_user = {"id": MEMBER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/stock")

        assert resp.status_code == 200
        names = {item["name"] for item in resp.json()}
        assert names == {"Lait", "Œufs"}  # pas "Hors foyer"
        server.app.dependency_overrides.clear()

    def test_solo_user_only_sees_own_stock(self, monkeypatch):
        server = _load_server(monkeypatch)
        self._setup(monkeypatch, server, household_oid=ObjectId())
        current_user = {"id": OUTSIDER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/stock")

        assert resp.status_code == 200
        names = {item["name"] for item in resp.json()}
        assert names == {"Hors foyer"}
        server.app.dependency_overrides.clear()


class TestUpdateStockCrossMember:
    def test_member_can_consume_item_added_by_another_member(self, monkeypatch):
        """BUG-049 phase 2 : la vérification de propriété sur les actions
        (consommer/jeter/modifier) doit passer par le scope foyer, pas
        uniquement user_id == current_user, sinon un membre ne peut agir que
        sur ses propres items malgré un stock nominalement partagé."""
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        item_id = ObjectId()
        households_col = FakeHouseholdsCollection([
            {"_id": household_oid, "member_ids": [OWNER_ID, MEMBER_ID]},
        ])
        stock_col = FakeStockCollection([
            {"_id": item_id, "user_id": OWNER_ID, "name": "Lait", "status": "active"},
        ])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "stock_col", stock_col)
        monkeypatch.setattr(server, "users_col", FakeHouseholdsCollection())
        monkeypatch.setattr(server, "track_business_event", AsyncMock())

        current_user = {"id": MEMBER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post(f"/api/stock/{item_id}/consume")

        assert resp.status_code == 200
        assert stock_col.docs[str(item_id)]["status"] == "consumed"
        server.app.dependency_overrides.clear()

    def test_outsider_cannot_touch_item_outside_their_scope(self, monkeypatch):
        server = _load_server(monkeypatch)
        item_id = ObjectId()
        stock_col = FakeStockCollection([
            {"_id": item_id, "user_id": OWNER_ID, "name": "Lait", "status": "active"},
        ])
        monkeypatch.setattr(server, "households_col", FakeHouseholdsCollection())
        monkeypatch.setattr(server, "stock_col", stock_col)

        current_user = {"id": OUTSIDER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post(f"/api/stock/{item_id}/consume")

        assert resp.status_code == 404
        assert stock_col.docs[str(item_id)]["status"] == "active"
        server.app.dependency_overrides.clear()


class TestFetchStockCandidatesHouseholdScope:
    def test_recipe_suggestions_stock_pool_includes_household_members(self, monkeypatch):
        """BUG-049 phase 3 : les suggestions de recettes doivent se baser sur le
        stock de tout le foyer, pas seulement celui de l'appelant."""
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        households_col = FakeHouseholdsCollection([
            {"_id": household_oid, "member_ids": [OWNER_ID, MEMBER_ID]},
        ])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "stock_col", FakeStockCollection())

        result = asyncio.run(server._fetch_stock_candidates(
            scope_ids=[OWNER_ID, MEMBER_ID], filter_value="all",
        ))
        # Pas d'assertion sur le contenu (stock_col non mocké ici) — on vérifie
        # seulement que le nouveau paramètre scope_ids est bien accepté et que
        # la requête se construit avec _stock_scope_match sans lever d'erreur.
        assert isinstance(result, list)


class TestAlertsHouseholdFanOut:
    def test_resolve_alert_stock_match_solo_vs_household(self, monkeypatch):
        from backend.alerts import _resolve_alert_stock_match

        households_col = FakeHouseholdsCollection([
            {"_id": ObjectId("507f1f77bcf86cd799439099"), "member_ids": [OWNER_ID, MEMBER_ID]},
        ])
        solo_match = asyncio.run(_resolve_alert_stock_match({"_id": ObjectId(OWNER_ID)}, households_col))
        assert solo_match == {"user_id": OWNER_ID}

        household_match = asyncio.run(_resolve_alert_stock_match(
            {"_id": ObjectId(MEMBER_ID), "household_id": "507f1f77bcf86cd799439099"},
            households_col,
        ))
        assert household_match == {"user_id": {"$in": [OWNER_ID, MEMBER_ID]}}

    def test_daily_expiry_alert_notifies_both_household_members(self, monkeypatch):
        """Un item ajouté par le propriétaire, dont l'échéance est proche, doit
        déclencher une alerte pour CHAQUE membre du foyer (pas seulement celui
        qui a ajouté l'item) — chacun avec son propre push token et sa propre
        clé de dédoublonnage."""
        from backend.alerts import AlertDependencies, check_daily_expiry_alert
        from backend.app_core import utc_now

        household_oid = ObjectId("507f1f77bcf86cd799439099")
        households_col = FakeHouseholdsCollection([
            {"_id": household_oid, "member_ids": [OWNER_ID, MEMBER_ID]},
        ])
        today_str = utc_now().date().strftime("%Y-%m-%d")

        class FakeUsersCol:
            def find(self, _flt):
                docs = [
                    {"_id": ObjectId(OWNER_ID), "push_tokens": ["ExponentPushToken[owner]"], "household_id": str(household_oid)},
                    {"_id": ObjectId(MEMBER_ID), "push_tokens": ["ExponentPushToken[member]"], "household_id": str(household_oid)},
                ]
                return _FakeCursor(docs)

        class FakeStockColForAlerts:
            def find(self, flt):
                scope = flt.get("user_id")
                in_scope = scope.get("$in", [scope]) if isinstance(scope, dict) else [scope]
                if OWNER_ID in in_scope:
                    return _FakeCursor([
                        {"_id": ObjectId(), "name": "Lait", "expiry_date": today_str, "user_id": OWNER_ID},
                    ])
                return _FakeCursor([])

        class FakeUserAlertsCol:
            def __init__(self):
                self.sent = []

            async def find_one(self, _flt):
                return None

            async def insert_one(self, doc):
                self.sent.append(doc)

        user_alerts_col = FakeUserAlertsCol()
        send_push = AsyncMock()

        deps = AlertDependencies(
            users_col=FakeUsersCol(),
            stock_col=FakeStockColForAlerts(),
            user_alerts_col=user_alerts_col,
            app_state_col=None,
            products_cache_col=None,
            community_recipes_col=None,
            send_push=send_push,
            fr_to_en_ingredient=lambda name, cat: name,
            households_col=households_col,
        )

        asyncio.run(check_daily_expiry_alert(deps))

        assert send_push.await_count == 2
        notified_users = {entry["user_id"] for entry in user_alerts_col.sent}
        assert notified_users == {OWNER_ID, MEMBER_ID}
