import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import server


class _FakeInsertCol:
    async def insert_one(self, payload):
        _ = payload


class _FakeApiLogsCol(_FakeInsertCol):
    async def find_one(self, query, sort=None, projection=None):
        _ = (query, sort, projection)
        return None


class _FakeDB:
    async def command(self, cmd):
        _ = cmd
        return {"ok": 1}


class _FakeUpdateResult:
    def __init__(self, matched_count=1):
        self.matched_count = matched_count


class _FakeUsersCol(_FakeInsertCol):
    def __init__(self, user_doc, matched_count=1):
        self.user_doc = user_doc
        self.matched_count = matched_count

    async def find_one(self, query, projection=None):
        _ = (query, projection)
        return dict(self.user_doc) if self.user_doc else None

    async def update_one(self, query, update, upsert=False):
        _ = (query, update, upsert)
        return _FakeUpdateResult(self.matched_count)


class _FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, field, direction):
        _ = (field, direction)
        return self

    def skip(self, value):
        _ = value
        return self

    def limit(self, value):
        _ = value
        return self

    async def to_list(self, length):
        _ = length
        return list(self.rows)


class _FakeBusinessEventsCol(_FakeInsertCol):
    def __init__(self, rows):
        self.rows = rows

    async def count_documents(self, query):
        _ = query
        return len(self.rows)

    def find(self, query):
        _ = query
        return _FakeCursor(self.rows)


class AdminSecurityEndpointTests(unittest.TestCase):
    user_id = "507f1f77bcf86cd799439011"

    def setUp(self):
        server.app.dependency_overrides = {}

    def tearDown(self):
        server.app.dependency_overrides = {}

    def test_admin_health_without_auth_returns_401(self):
        with patch("server.api_request_logs_col", _FakeApiLogsCol()), patch("server.db", _FakeDB()):
            client = TestClient(server.app)
            response = client.get("/api/admin/monitoring/health")
        self.assertEqual(response.status_code, 401)

    def test_admin_services_without_auth_returns_401(self):
        with patch("server.api_request_logs_col", _FakeApiLogsCol()), patch("server.db", _FakeDB()):
            client = TestClient(server.app)
            response = client.get("/api/admin/monitoring/services")
        self.assertEqual(response.status_code, 401)

    def test_admin_health_with_non_admin_returns_403(self):
        async def _override_user():
            return {"id": self.user_id, "email": "user@keepeat.app", "is_admin": False}

        server.app.dependency_overrides[server._get_current_user] = _override_user
        with patch("server.users_col", _FakeUsersCol({"email": "user@keepeat.app", "is_admin": False})), patch("server.api_request_logs_col", _FakeApiLogsCol()), patch("server.db", _FakeDB()):
            client = TestClient(server.app)
            response = client.get("/api/admin/monitoring/health")
        self.assertEqual(response.status_code, 403)

    def test_admin_events_with_admin_returns_200(self):
        async def _override_user():
            return {"id": self.user_id, "email": "admin@keepeat.app", "is_admin": True}

        server.app.dependency_overrides[server._get_current_user] = _override_user
        rows = [{"_id": "evt1", "event_name": "user_registered", "event_category": "auth", "created_at": "2026-03-31T00:00:00+00:00"}]
        with patch("server.users_col", _FakeUsersCol({"email": "admin@keepeat.app", "is_admin": True})), patch("server.api_request_logs_col", _FakeApiLogsCol()), patch("server.business_events_col", _FakeBusinessEventsCol(rows)):
            client = TestClient(server.app)
            response = client.get("/api/admin/monitoring/events")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("total"), 1)

    def test_set_premium_requires_admin(self):
        async def _override_user():
            return {"id": self.user_id, "email": "user@keepeat.app", "is_admin": False}

        server.app.dependency_overrides[server._get_current_user] = _override_user
        with patch("server.users_col", _FakeUsersCol({"email": "user@keepeat.app", "is_admin": False})), patch("server.api_request_logs_col", _FakeApiLogsCol()):
            client = TestClient(server.app)
            response = client.put("/api/admin/users/a@b.com/set-premium?premium=true")
        self.assertEqual(response.status_code, 403)

    def test_set_premium_admin_success(self):
        async def _override_user():
            return {"id": self.user_id, "email": "admin@keepeat.app", "is_admin": True}

        server.app.dependency_overrides[server._get_current_user] = _override_user
        with patch("server.users_col", _FakeUsersCol({"email": "admin@keepeat.app", "is_admin": True}, matched_count=1)), patch("server.api_request_logs_col", _FakeApiLogsCol()):
            client = TestClient(server.app)
            response = client.put("/api/admin/users/a@b.com/set-premium?premium=true")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("ok"))


if __name__ == "__main__":
    unittest.main()
