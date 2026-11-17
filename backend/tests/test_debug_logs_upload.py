"""Tests for debug logs upload endpoint."""

import os
import glob
import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from backend import server
from backend.auth_utils import create_token

app = server.app


@pytest.fixture(autouse=True)
def cleanup_test_logs():
    """Automatically cleanup debug logs created during tests."""
    # Setup: record existing log files before test
    logs_dir = os.path.join(os.getcwd(), "LOGS")
    existing_files = set(glob.glob(os.path.join(logs_dir, "*.txt"))) if os.path.exists(logs_dir) else set()

    yield  # Run the test

    # Teardown: remove only files created by this test
    if os.path.exists(logs_dir):
        current_files = set(glob.glob(os.path.join(logs_dir, "*.txt")))
        new_files = current_files - existing_files
        for filepath in new_files:
            try:
                os.remove(filepath)
            except OSError:
                pass  # Ignore cleanup errors


def test_upload_debug_logs_requires_auth():
    """Sans jeton : 401. Le 422 toléré auparavant masquait BUG-088 (la route
    exigeait un paramètre de requête `users_col`)."""
    client = TestClient(app)
    response = client.post(
        "/api/debug/logs/upload",
        json={"content": "test logs", "filename": "test.txt"},
    )
    assert response.status_code == 401


def test_upload_debug_logs_authenticates_with_real_bearer_token(monkeypatch):
    """[REGRESSION] BUG-088 — la route dépendait directement de
    `auth_utils.get_current_user(users_col, credentials)` au lieu de
    l'enveloppe `_get_current_user` : FastAPI faisait de `users_col` un
    paramètre de requête obligatoire et rejetait en 422 tout envoi réel de
    l'application. Aucun remplacement de dépendance ici : vrai jeton, vraie
    chaîne d'authentification."""
    user_id = str(ObjectId())

    class _Users:
        async def find_one(self, query, *args, **kwargs):
            if query == {"_id": ObjectId(user_id)}:
                return {"_id": ObjectId(user_id), "email": "real@example.com"}
            return None

    monkeypatch.setattr(server, "users_col", _Users())
    client = TestClient(app)
    response = client.post(
        "/api/debug/logs/upload",
        json={"content": "[INFO] envoi réel", "filename": "keepeat_swipe_logs_real.txt"},
        headers={"Authorization": f"Bearer {create_token(user_id)}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True


def test_upload_debug_logs_success(monkeypatch):
    """Successfully upload debug logs with mocked auth."""
    client = TestClient(app)
    app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1", "email": "test@example.com"}

    response = client.post(
        "/api/debug/logs/upload",
        json={
            "content": "[INFO] Test log content\n[ERROR] Some error",
            "filename": "keepeat_swipe_logs_2026-05-18_12-30-45.txt",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["message"] == "Debug logs uploaded successfully"
    assert "keepeat_swipe_logs" in data["filename"]

    app.dependency_overrides.clear()


def test_upload_debug_logs_invalid_filename_path_traversal():
    """Reject filenames with path traversal attempts."""
    client = TestClient(app)
    app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1", "email": "test@example.com"}

    response = client.post(
        "/api/debug/logs/upload",
        json={"content": "test logs", "filename": "../../../etc/passwd"},
    )
    assert response.status_code == 400

    app.dependency_overrides.clear()


def test_upload_debug_logs_invalid_filename_backslash():
    """Reject filenames with backslashes."""
    client = TestClient(app)
    app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1", "email": "test@example.com"}

    response = client.post(
        "/api/debug/logs/upload",
        json={"content": "test logs", "filename": "..\\..\\evil.txt"},
    )
    assert response.status_code == 400

    app.dependency_overrides.clear()


def test_upload_debug_logs_missing_content():
    """Reject request with missing content."""
    client = TestClient(app)
    app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1", "email": "test@example.com"}

    response = client.post(
        "/api/debug/logs/upload",
        json={"filename": "test.txt"},
    )
    assert response.status_code == 422

    app.dependency_overrides.clear()


def test_upload_debug_logs_missing_filename():
    """Reject request with missing filename."""
    client = TestClient(app)
    app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1", "email": "test@example.com"}

    response = client.post(
        "/api/debug/logs/upload",
        json={"content": "test logs"},
    )
    assert response.status_code == 422

    app.dependency_overrides.clear()


def test_upload_debug_logs_empty_content():
    """Allow empty content (edge case)."""
    client = TestClient(app)
    app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1", "email": "test@example.com"}

    response = client.post(
        "/api/debug/logs/upload",
        json={"content": "", "filename": "empty_logs.txt"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True

    app.dependency_overrides.clear()


def test_upload_debug_logs_response_includes_filename():
    """Response includes the stored filename with timestamp and email."""
    client = TestClient(app)
    app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1", "email": "test@example.com"}

    response = client.post(
        "/api/debug/logs/upload",
        json={
            "content": "test logs",
            "filename": "keepeat_swipe_logs_2026-05-18_12-30-45.txt",
        },
    )
    assert response.status_code == 200
    data = response.json()
    filename = data["filename"]
    assert "keepeat_swipe_logs" in filename
    assert filename.endswith(".txt")
    assert len(filename) > len("keepeat_swipe_logs_2026-05-18_12-30-45.txt")

    app.dependency_overrides.clear()
