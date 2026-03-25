import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib import error

# Variables d'environnement minimales pour les tests
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

# Ajout du backend au PYTHONPATH
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import server
from scripts import warmup_ping


class WarmupBackendTests(unittest.TestCase):
    def test_api_health_route_is_light_and_ok(self):
        # Vérifie que la route existe et accepte GET
        route = next(r for r in server.app.routes if getattr(r, "path", None) == "/api/health")
        self.assertIn("GET", getattr(route, "methods", set()))
        self.assertIn(getattr(route, "status_code", 200), (None, 200))

        # Vérifie la réponse
        payload = asyncio.run(server.health())
        self.assertEqual(payload, {"status": "ok"})

    def test_run_backend_warmup_does_not_crash_on_partial_failures(self):
        class FakeDb:
            async def command(self, _name):
                raise RuntimeError("db down")

        with patch("server.load_local_recipes", side_effect=RuntimeError("catalog broken")):
            with patch("server.db", FakeDb()):
                summary = asyncio.run(server.run_backend_warmup())

        self.assertFalse(summary["catalog_loaded"])
        self.assertFalse(summary["db_ping_ok"])
        self.assertIsInstance(summary["duration_ms"], float)
        self.assertGreaterEqual(summary["duration_ms"], 0.0)


class WarmupPingScriptTests(unittest.TestCase):
    def test_run_ping_success(self):
        fake_response = MagicMock()
        fake_response.status = 200
        fake_response.read.return_value = b'{"status":"ok"}'
        fake_response.__enter__.return_value = fake_response
        fake_response.__exit__.return_value = False

        with patch("scripts.warmup_ping.request.urlopen", return_value=fake_response):
            ok = warmup_ping.run_ping("http://localhost:8000/api/health", timeout_seconds=2.0)

        self.assertTrue(ok)

    def test_run_ping_error(self):
        with patch(
            "scripts.warmup_ping.request.urlopen",
            side_effect=error.URLError("unreachable"),
        ):
            ok = warmup_ping.run_ping("http://localhost:8000/api/health", timeout_seconds=2.0)

        self.assertFalse(ok)

    def test_run_ping_non_200_status(self):
        fake_response = MagicMock()
        fake_response.status = 503
        fake_response.read.return_value = b'Service Unavailable'
        fake_response.__enter__.return_value = fake_response
        fake_response.__exit__.return_value = False

        with patch("scripts.warmup_ping.request.urlopen", return_value=fake_response):
            ok = warmup_ping.run_ping("http://localhost:8000/api/health", timeout_seconds=2.0)

        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
