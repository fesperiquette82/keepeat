from pathlib import Path
import sys

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))
from test_mode import ensure_external_allowed, external_services_disabled, is_test_env, mock_openfoodfacts_enabled


def test_test_mode_flags_default_to_false(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DISABLE_EXTERNAL_SERVICES", raising=False)
    monkeypatch.delenv("MOCK_OPEN_FOOD_FACTS", raising=False)

    assert is_test_env() is False
    assert external_services_disabled() is False
    assert mock_openfoodfacts_enabled() is False


def test_test_mode_blocks_external_calls_when_disabled(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DISABLE_EXTERNAL_SERVICES", "true")

    with pytest.raises(RuntimeError):
        ensure_external_allowed("openfoodfacts")


def test_server_declares_test_seed_and_reset_routes():
    content = (REPO_ROOT / "backend" / "server.py").read_text(encoding="utf-8")

    assert '@app.post("/api/test/reset")' in content
    assert '@app.post("/api/test/seed")' in content
    assert "if not is_test_env():" in content


def test_server_blocks_external_services_in_test_mode():
    content = (REPO_ROOT / "backend" / "server.py").read_text(encoding="utf-8")

    assert 'ensure_external_allowed("emails")' in content
    assert 'ensure_external_allowed("billing")' in content
    assert 'ensure_external_allowed("openfoodfacts")' in content
    assert 'ensure_external_allowed("ocr")' in content
    assert "mock_push_enabled()" in content


def test_test_mode_fixtures_define_deterministic_e2e_free_account():
    content = (REPO_ROOT / "backend" / "test_mode.py").read_text(encoding="utf-8")

    assert '"email": "e2e.free@keepeat.test"' in content
    assert '"password": "TestPassword123!"' in content
    assert '"is_premium": False' in content
    assert '"subscription_status": "inactive"' in content


def test_test_seed_route_upserts_verified_test_users():
    content = (REPO_ROOT / "backend" / "server.py").read_text(encoding="utf-8")

    assert 'free_fixture = TEST_FIXTURES["users"]["free"]' in content
    # E1 : le seed doit écrire la clé `hashed_password` (alignée sur register/login),
    # jamais `password_hash` (sinon le login des comptes seedés plante en 500/KeyError).
    assert '{"$set": {"email": free_fixture["email"], "hashed_password": free_password_hash, "is_premium": False, "subscription_status": "inactive", "email_verified": True}}' in content
    assert '"password_hash"' not in content
