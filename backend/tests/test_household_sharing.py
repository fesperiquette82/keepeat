"""Tests de non-régression — BUG-049 (partage foyer, phase 1).

Phase 1 : création/invitation/adhésion/départ d'un foyer, et résolution de
l'abonnement premium via le propriétaire du foyer pour les membres (aucune
donnée de stock n'est encore partagée — phase 2, hors périmètre).
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from fastapi import HTTPException

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


class FakeMongoCollection:
    """Collection Mongo async minimale en mémoire — couvre insert_one, find_one,
    update_one ($set/$unset/$addToSet/$pull), delete_one, find(...).to_list()."""

    def __init__(self, docs=None):
        self.docs: dict[str, dict] = {}
        for doc in docs or []:
            self.docs[str(doc["_id"])] = dict(doc)

    async def insert_one(self, doc):
        _id = doc.get("_id") or ObjectId()
        doc = dict(doc)
        doc["_id"] = _id
        self.docs[str(_id)] = doc
        return type("Result", (), {"inserted_id": _id})()

    async def find_one(self, flt, projection=None):
        _id = flt.get("_id")
        if _id is not None:
            doc = self.docs.get(str(_id))
            return dict(doc) if doc else None
        for doc in self.docs.values():
            if all(doc.get(k) == v for k, v in flt.items()):
                return dict(doc)
        return None

    async def update_one(self, flt, update):
        _id = flt.get("_id")
        doc = self.docs.get(str(_id)) if _id is not None else None
        if doc is None:
            return type("Result", (), {"matched_count": 0})()
        for key, val in update.get("$set", {}).items():
            doc[key] = val
        for key in update.get("$unset", {}):
            doc.pop(key, None)
        for key, val in update.get("$addToSet", {}).items():
            doc.setdefault(key, [])
            if val not in doc[key]:
                doc[key].append(val)
        for key, val in update.get("$pull", {}).items():
            doc[key] = [v for v in doc.get(key, []) if v != val]
        return type("Result", (), {"matched_count": 1})()

    async def delete_one(self, flt):
        _id = flt.get("_id")
        self.docs.pop(str(_id), None)
        return type("Result", (), {"deleted_count": 1})()

    def find(self, flt=None):
        flt = flt or {}
        ids = None
        if "_id" in flt and isinstance(flt["_id"], dict) and "$in" in flt["_id"]:
            ids = {str(v) for v in flt["_id"]["$in"]}
        matched = [
            dict(doc) for key, doc in self.docs.items()
            if ids is None or key in ids
        ]
        return _FakeCursor(matched)


class _FakeCursor:
    def __init__(self, items):
        self._items = items

    async def to_list(self, length=100):
        return self._items[:length]


def _user_doc(user_id, *, email="a@b.com", is_premium=False, household_id=None):
    doc = {"_id": ObjectId(user_id), "email": email, "is_premium": is_premium, "subscription_status": "active" if is_premium else "inactive"}
    if household_id:
        doc["household_id"] = household_id
    return doc


OWNER_ID = "507f1f77bcf86cd799439011"
MEMBER_ID = "507f1f77bcf86cd799439012"
OUTSIDER_ID = "507f1f77bcf86cd799439013"


class TestCreateHousehold:
    def test_create_household_success(self, monkeypatch):
        server = _load_server(monkeypatch)
        users_col = FakeMongoCollection([_user_doc(OWNER_ID)])
        households_col = FakeMongoCollection()
        monkeypatch.setattr(server, "users_col", users_col)
        monkeypatch.setattr(server, "households_col", households_col)
        current_user = {"id": OWNER_ID, "email": "a@b.com"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/household", json={"name": "Chez nous"})

        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Chez nous"
        assert body["owner_id"] == OWNER_ID
        assert len(body["members"]) == 1
        assert body["members"][0]["role"] == "owner"
        assert users_col.docs[OWNER_ID]["household_id"] == body["id"]
        server.app.dependency_overrides.clear()

    def test_create_household_rejected_if_already_in_one(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setattr(server, "users_col", FakeMongoCollection([_user_doc(OWNER_ID)]))
        monkeypatch.setattr(server, "households_col", FakeMongoCollection())
        current_user = {"id": OWNER_ID, "household_id": "existing-household"}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/household", json={"name": "Chez nous"})

        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "ALREADY_IN_HOUSEHOLD"
        server.app.dependency_overrides.clear()


class TestInviteAndJoin:
    def _setup_household(self, monkeypatch, server):
        household_oid = ObjectId()
        household_doc = {
            "_id": household_oid,
            "name": "Chez nous",
            "owner_id": OWNER_ID,
            "member_ids": [OWNER_ID],
            "created_at": "2026-01-01T00:00:00+00:00",
        }
        households_col = FakeMongoCollection([household_doc])
        users_col = FakeMongoCollection([
            _user_doc(OWNER_ID, household_id=str(household_oid), is_premium=True),
            _user_doc(MEMBER_ID, email="member@b.com"),
        ])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "users_col", users_col)
        return household_oid, households_col, users_col

    def test_invite_requires_owner(self, monkeypatch):
        server = _load_server(monkeypatch)
        household_oid, households_col, users_col = self._setup_household(monkeypatch, server)
        current_user = {"id": MEMBER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/household/invite")

        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "NOT_HOUSEHOLD_OWNER"
        server.app.dependency_overrides.clear()

    def test_owner_generates_invite_and_member_joins(self, monkeypatch):
        server = _load_server(monkeypatch)
        household_oid, households_col, users_col = self._setup_household(monkeypatch, server)
        owner_user = {"id": OWNER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: owner_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        invite_resp = client.post("/api/household/invite")
        assert invite_resp.status_code == 200
        token = invite_resp.json()["token"]

        member_user = {"id": MEMBER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: member_user
        join_resp = client.post("/api/household/join", json={"token": token})

        assert join_resp.status_code == 200
        body = join_resp.json()
        member_ids = [m["user_id"] for m in body["members"]]
        assert MEMBER_ID in member_ids
        assert users_col.docs[MEMBER_ID]["household_id"] == str(household_oid)
        server.app.dependency_overrides.clear()

    def test_join_rejects_invalid_token(self, monkeypatch):
        server = _load_server(monkeypatch)
        self._setup_household(monkeypatch, server)
        current_user = {"id": MEMBER_ID}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/household/join", json={"token": "garbage"})

        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INVALID_INVITE_TOKEN"
        server.app.dependency_overrides.clear()

    def test_join_rejected_if_household_full(self, monkeypatch):
        server = _load_server(monkeypatch)
        household_oid, households_col, users_col = self._setup_household(monkeypatch, server)
        full_members = [OWNER_ID] + [f"507f1f77bcf86cd79943901{i}" for i in range(2, 7)]
        households_col.docs[str(household_oid)]["member_ids"] = full_members
        owner_user = {"id": OWNER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: owner_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        invite_resp = client.post("/api/household/invite")
        assert invite_resp.status_code == 409
        assert invite_resp.json()["detail"]["code"] == "HOUSEHOLD_FULL"
        server.app.dependency_overrides.clear()


class TestLeaveHousehold:
    def test_member_leaves(self, monkeypatch):
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        households_col = FakeMongoCollection([{
            "_id": household_oid, "name": "Chez nous", "owner_id": OWNER_ID,
            "member_ids": [OWNER_ID, MEMBER_ID], "created_at": "2026-01-01T00:00:00+00:00",
        }])
        users_col = FakeMongoCollection([
            _user_doc(OWNER_ID, household_id=str(household_oid)),
            _user_doc(MEMBER_ID, household_id=str(household_oid)),
        ])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "users_col", users_col)
        current_user = {"id": MEMBER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/household/leave")

        assert resp.status_code == 204
        assert MEMBER_ID not in households_col.docs[str(household_oid)]["member_ids"]
        assert "household_id" not in users_col.docs[MEMBER_ID]
        server.app.dependency_overrides.clear()

    def test_owner_cannot_leave_with_other_members(self, monkeypatch):
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        households_col = FakeMongoCollection([{
            "_id": household_oid, "name": "Chez nous", "owner_id": OWNER_ID,
            "member_ids": [OWNER_ID, MEMBER_ID], "created_at": "2026-01-01T00:00:00+00:00",
        }])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "users_col", FakeMongoCollection([_user_doc(OWNER_ID, household_id=str(household_oid))]))
        current_user = {"id": OWNER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/household/leave")

        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "OWNER_CANNOT_LEAVE_WITH_MEMBERS"
        server.app.dependency_overrides.clear()

    def test_owner_leaving_alone_dissolves_household(self, monkeypatch):
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        households_col = FakeMongoCollection([{
            "_id": household_oid, "name": "Chez nous", "owner_id": OWNER_ID,
            "member_ids": [OWNER_ID], "created_at": "2026-01-01T00:00:00+00:00",
        }])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "users_col", FakeMongoCollection([_user_doc(OWNER_ID, household_id=str(household_oid))]))
        current_user = {"id": OWNER_ID, "household_id": str(household_oid)}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/household/leave")

        assert resp.status_code == 204
        assert str(household_oid) not in households_col.docs
        server.app.dependency_overrides.clear()


class TestResolveBillingUserDoc:
    def test_own_premium_returns_self(self, monkeypatch):
        server = _load_server(monkeypatch)
        from backend.household_service import resolve_billing_user_doc

        user_doc = _user_doc(OWNER_ID, is_premium=True)
        result = asyncio.run(resolve_billing_user_doc(
            user_doc, users_col=FakeMongoCollection(), households_col=FakeMongoCollection(),
        ))
        assert result == user_doc

    def test_no_household_returns_self(self, monkeypatch):
        server = _load_server(monkeypatch)
        from backend.household_service import resolve_billing_user_doc

        user_doc = _user_doc(MEMBER_ID)
        result = asyncio.run(resolve_billing_user_doc(
            user_doc, users_col=FakeMongoCollection(), households_col=FakeMongoCollection(),
        ))
        assert result == user_doc

    def test_household_member_resolves_to_premium_owner(self, monkeypatch):
        server = _load_server(monkeypatch)
        from backend.household_service import resolve_billing_user_doc

        household_oid = ObjectId()
        households_col = FakeMongoCollection([{
            "_id": household_oid, "name": "Chez nous", "owner_id": OWNER_ID,
            "member_ids": [OWNER_ID, MEMBER_ID], "created_at": "2026-01-01T00:00:00+00:00",
        }])
        users_col = FakeMongoCollection([_user_doc(OWNER_ID, is_premium=True)])
        member_doc = _user_doc(MEMBER_ID, household_id=str(household_oid))

        result = asyncio.run(resolve_billing_user_doc(
            member_doc, users_col=users_col, households_col=households_col,
        ))
        assert result["_id"] == ObjectId(OWNER_ID)
        assert result["is_premium"] is True

    def test_household_not_found_falls_back_to_self(self, monkeypatch):
        server = _load_server(monkeypatch)
        from backend.household_service import resolve_billing_user_doc

        member_doc = _user_doc(MEMBER_ID, household_id=str(ObjectId()))
        result = asyncio.run(resolve_billing_user_doc(
            member_doc, users_col=FakeMongoCollection(), households_col=FakeMongoCollection(),
        ))
        assert result == member_doc


class TestFeatureAccessViaHousehold:
    def test_member_gets_predictions_via_premium_owner(self, monkeypatch):
        """FEATURE_PREDICTIONS est 100% bloqué en gratuit (entitlements.py) — un
        membre de foyer dont le propriétaire est premium doit y avoir accès, sans
        avoir lui-même payé quoi que ce soit (BUG-049)."""
        server = _load_server(monkeypatch)
        household_oid = ObjectId()
        households_col = FakeMongoCollection([{
            "_id": household_oid, "owner_id": OWNER_ID, "member_ids": [OWNER_ID, MEMBER_ID],
        }])
        users_col = FakeMongoCollection([_user_doc(OWNER_ID, is_premium=True)])
        monkeypatch.setattr(server, "households_col", households_col)
        monkeypatch.setattr(server, "users_col", users_col)

        member_user = {"id": MEMBER_ID, "household_id": str(household_oid), "is_premium": False}
        result = asyncio.run(server._enforce_feature_access(
            current_user=member_user, feature=server.FEATURE_PREDICTIONS,
        ))
        assert result["policy"]["allowed"] is True

    def test_solo_free_user_still_blocked_from_predictions(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setattr(server, "households_col", FakeMongoCollection())
        monkeypatch.setattr(server, "users_col", FakeMongoCollection())

        solo_user = {"id": OUTSIDER_ID, "is_premium": False}
        with pytest.raises(HTTPException) as exc:
            asyncio.run(server._enforce_feature_access(
                current_user=solo_user, feature=server.FEATURE_PREDICTIONS,
            ))
        assert exc.value.status_code == 403
