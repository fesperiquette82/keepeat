"""Tests de non-régression — initialisation conditionnelle de Sentry (BUG-040).

Constat de l'audit commercial (point « voir ce qui se passe ») : aucun crash
reporting n'existait côté backend — une exception non gérée en production
n'était visible que dans les logs Render, sans alerte ni agrégation.

sentry_sdk est désormais une dépendance permanente (cf. requirements.txt),
mais `sentry_sdk.init()` ne doit être appelé QUE si SENTRY_DSN est configuré
(aucun compte Sentry n'existe encore pour ce projet) : l'import doit rester un
no-op total tant que la variable est absente.
"""
import importlib
import sys
from pathlib import Path
from unittest.mock import MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    for mod in ("server", "models", "alerts"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


def test_sentry_init_not_called_when_dsn_absent(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    fake_init = MagicMock()
    monkeypatch.setattr("sentry_sdk.init", fake_init)

    _load_server(monkeypatch)

    fake_init.assert_not_called()


def test_sentry_init_called_with_dsn_when_configured(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://fake@example.ingest.sentry.io/1")
    monkeypatch.setenv("APP_ENV", "production")
    fake_init = MagicMock()
    monkeypatch.setattr("sentry_sdk.init", fake_init)

    _load_server(monkeypatch)

    fake_init.assert_called_once()
    _, kwargs = fake_init.call_args
    assert kwargs["dsn"] == "https://fake@example.ingest.sentry.io/1"
    assert kwargs["environment"] == "production"
    assert kwargs["traces_sample_rate"] == 0.0
    assert kwargs["release"]
