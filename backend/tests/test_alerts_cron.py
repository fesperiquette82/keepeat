"""Tests de non-régression — /api/internal/alerts/run (BUG-037).

Avant correction, les vérifications d'alertes (rappels produits, inactivité,
péremption J-2/J-0, résumé hebdomadaire) tournaient dans une boucle interne au
process backend (`while True: await asyncio.sleep(6 * 3600)` — 6h d'attente
AVANT le premier passage). Sur Render, la disponibilité du process n'est pas
garantie en continu : chaque redémarrage (déploiement, mise en veille,
incident) remettait ce délai à zéro, ce qui pouvait empêcher indéfiniment
l'envoi des alertes de péremption — la promesse centrale du produit.

Remplacé par un endpoint (`/api/internal/alerts/run`) déclenché par un cron
GitHub Actions externe (.github/workflows/alerts-cron.yml), protégé par un
jeton statique (ALERTS_CRON_TOKEN — même convention que GOOGLE_RTDN_TOKEN pour
le webhook Google Play RTDN, déjà dans le code).
"""
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    for mod in ("server", "models", "alerts"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


def _mock_request_logging(server, monkeypatch):
    # api_request_logging_middleware journalise chaque requête /api/* via la
    # vraie collection Mongo (inatteignable dans ces tests) : sans ce mock,
    # chaque appel TestClient attend ~30s (timeout de sélection de serveur Motor)
    # avant que le try/except best-effort de la middleware n'abandonne.
    api_request_logs_col = MagicMock()
    api_request_logs_col.insert_one = AsyncMock()
    monkeypatch.setattr(server, "api_request_logs_col", api_request_logs_col)


def _fake_deps(server):
    # `app.state.alert_deps` n'est normalement peuplé que par lifespan(), qui ne
    # s'exécute pas avec un TestClient utilisé hors context manager (comme
    # partout ailleurs dans cette suite) — on le construit donc ici directement.
    return server.AlertDependencies(
        users_col=MagicMock(),
        stock_col=MagicMock(),
        user_alerts_col=MagicMock(),
        app_state_col=MagicMock(),
        products_cache_col=MagicMock(),
        community_recipes_col=MagicMock(),
        send_push=AsyncMock(),
        fr_to_en_ingredient=lambda name, lang: name,
    )


class TestAlertsCronAuth:
    def test_returns_503_when_token_not_configured(self, monkeypatch):
        server = _load_server(monkeypatch)
        _mock_request_logging(server, monkeypatch)
        monkeypatch.delenv("ALERTS_CRON_TOKEN", raising=False)
        server.app.state.alert_deps = _fake_deps(server)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/alerts/run")
        assert resp.status_code == 503

    def test_returns_401_on_wrong_token(self, monkeypatch):
        server = _load_server(monkeypatch)
        _mock_request_logging(server, monkeypatch)
        monkeypatch.setenv("ALERTS_CRON_TOKEN", "correct-token")
        server.app.state.alert_deps = _fake_deps(server)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/alerts/run", headers={"Authorization": "Bearer wrong"})
        assert resp.status_code == 401

    def test_returns_401_when_no_authorization_header(self, monkeypatch):
        server = _load_server(monkeypatch)
        _mock_request_logging(server, monkeypatch)
        monkeypatch.setenv("ALERTS_CRON_TOKEN", "correct-token")
        server.app.state.alert_deps = _fake_deps(server)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/alerts/run")
        assert resp.status_code == 401


class TestAlertsCronExecution:
    def test_correct_token_runs_all_four_checks(self, monkeypatch):
        server = _load_server(monkeypatch)
        _mock_request_logging(server, monkeypatch)
        monkeypatch.setenv("ALERTS_CRON_TOKEN", "correct-token")
        server.app.state.alert_deps = _fake_deps(server)

        recalls_mock = AsyncMock()
        inactivity_mock = AsyncMock()
        daily_mock = AsyncMock()
        weekly_mock = AsyncMock()
        monkeypatch.setattr(server, "check_recalls_and_notify", recalls_mock)
        monkeypatch.setattr(server, "check_inactivity_and_notify", inactivity_mock)
        monkeypatch.setattr(server, "check_daily_expiry_alert", daily_mock)
        monkeypatch.setattr(server, "check_weekly_expiry_summary", weekly_mock)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/alerts/run", headers={"Authorization": "Bearer correct-token"})

        assert resp.status_code == 200
        payload = resp.json()
        assert payload["results"] == {
            "recalls": "ok",
            "inactivity": "ok",
            "daily_expiry": "ok",
            "weekly_expiry": "ok",
        }
        recalls_mock.assert_awaited_once()
        inactivity_mock.assert_awaited_once()
        daily_mock.assert_awaited_once()
        weekly_mock.assert_awaited_once()

    def test_one_check_failing_does_not_block_the_others(self, monkeypatch):
        """Une panne (ex: flux de rappels RSS indisponible) ne doit pas empêcher
        les autres vérifications — la péremption, notamment — de tourner."""
        server = _load_server(monkeypatch)
        _mock_request_logging(server, monkeypatch)
        monkeypatch.setenv("ALERTS_CRON_TOKEN", "correct-token")
        server.app.state.alert_deps = _fake_deps(server)

        daily_mock = AsyncMock()
        monkeypatch.setattr(server, "check_recalls_and_notify", AsyncMock(side_effect=RuntimeError("rss down")))
        monkeypatch.setattr(server, "check_inactivity_and_notify", AsyncMock())
        monkeypatch.setattr(server, "check_daily_expiry_alert", daily_mock)
        monkeypatch.setattr(server, "check_weekly_expiry_summary", AsyncMock())

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/alerts/run", headers={"Authorization": "Bearer correct-token"})

        assert resp.status_code == 200
        payload = resp.json()
        assert payload["results"]["recalls"].startswith("error:")
        assert payload["results"]["daily_expiry"] == "ok"
        daily_mock.assert_awaited_once()


def test_alert_loop_no_longer_exists(monkeypatch):
    """Verrou : la boucle interne à sleep-avant-premier-passage (source du bug)
    ne doit pas revenir dans alerts.py."""
    _load_server(monkeypatch)
    import alerts
    assert not hasattr(alerts, "alert_loop")
