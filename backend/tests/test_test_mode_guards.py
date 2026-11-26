import asyncio
import importlib
import re
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

    assert '"email": "e2e.free@example.com"' in content
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


def test_e2e_fixture_accounts_pass_login_validation():
    """[REGRESSION] BUG-093 — les comptes E2E étaient en `@keepeat.test`.
    Le seed les écrit directement en base, mais `/api/auth/login` valide
    l'e-mail (EmailStr) et email-validator refuse les domaines réservés
    (`.test`, `.local`…) : chaque connexion Maestro recevait un 422. Chaque
    compte du jeu de test doit passer la validation de l'endpoint de connexion."""
    from backend.models import UserLogin
    from backend.test_mode import FIXTURES

    for name, user in FIXTURES["users"].items():
        login = UserLogin(email=user["email"], password=user["password"])
        assert login.email == user["email"], name


class _FakeCollection:
    """Collection Mongo réduite à `delete_many`, filtres égalité et `$regex`."""

    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]

    async def delete_many(self, query):
        def matches(doc):
            for key, condition in query.items():
                if isinstance(condition, dict) and "$regex" in condition:
                    if not re.search(condition["$regex"], str(doc.get(key, ""))):
                        return False
                elif doc.get(key) != condition:
                    return False
            return True

        self.docs = [doc for doc in self.docs if not matches(doc)]


def test_bug_106_e2e_reset_clears_quota_counters_only(monkeypatch):
    """[REGRESSION] BUG-106 — les comptes E2E sont réécrits par e-mail et
    gardent leur identifiant d'un scénario à l'autre. `/api/test/reset`
    n'effaçait pas leurs compteurs de quota (`app_state`, `usage:…`) : au
    9e scénario de la suite nocturne, le quota gratuit de suggestions était
    épuisé, l'app ouvrait l'écran Premium et les 6 scénarios suivants
    échouaient. Le reste de `app_state` n'est pas touché."""
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.setenv("APP_ENV", "test")
    sys.modules.pop("server", None)
    server = importlib.import_module("server")

    app_state = _FakeCollection([
        {"_id": "usage:6b0819cf0493dad44296aff2:ai_recipes:2026-11", "used": 8},
        {"_id": "usage:6b0819cf0493dad44296aff2:ocr_receipt:2026-11", "used": 2},
        {"_id": "priority_refresh:6b0819cf0493dad44296aff2", "count": 1},
        {"key": "last_recall_check"},
    ])
    for name in ("stock_col", "products_cache_col", "receipt_tickets_col", "business_events_col", "service_usage_logs_col"):
        monkeypatch.setattr(server, name, _FakeCollection([{"_id": "x"}]))
    users = _FakeCollection([{"email": "e2e.free@example.com"}, {"email": "old@keepeat.test"}])
    monkeypatch.setattr(server, "users_col", users)
    monkeypatch.setattr(server, "app_state_col", app_state)

    assert asyncio.run(server.test_reset_data()) == {"ok": True, "action": "reset"}

    assert [doc.get("_id", doc.get("key")) for doc in app_state.docs] == [
        "priority_refresh:6b0819cf0493dad44296aff2",
        "last_recall_check",
    ]
    assert [doc["email"] for doc in users.docs] == ["e2e.free@example.com"]
