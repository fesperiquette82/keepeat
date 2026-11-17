"""BUG-075 : le délai de sélection de serveur MongoDB doit être réglable.

Sans réglage, un MongoDB absent coûtait 30 s par opération ; la suite complète
mettait 58 min en CI au lieu de 2. Ces tests figent le contrat du helper qui
lit le réglage, et vérifient que les environnements de test l'activent.
"""
from __future__ import annotations

import os
import unittest
from pathlib import Path

from backend.mongo_settings import (
    MAX_SERVER_SELECTION_TIMEOUT_MS,
    MIN_SERVER_SELECTION_TIMEOUT_MS,
    SERVER_SELECTION_TIMEOUT_ENV,
    mongo_client_kwargs,
    server_selection_timeout_ms,
)


class ServerSelectionTimeoutTests(unittest.TestCase):
    def test_unset_means_driver_default(self):
        self.assertIsNone(server_selection_timeout_ms(None))

    def test_blank_means_driver_default(self):
        self.assertIsNone(server_selection_timeout_ms("   "))

    def test_garbage_never_prevents_startup(self):
        self.assertIsNone(server_selection_timeout_ms("trente secondes"))

    def test_readable_value_is_used(self):
        self.assertEqual(server_selection_timeout_ms("500"), 500)
        self.assertEqual(server_selection_timeout_ms(" 2000 "), 2000)

    def test_value_is_bounded(self):
        self.assertEqual(server_selection_timeout_ms("1"), MIN_SERVER_SELECTION_TIMEOUT_MS)
        self.assertEqual(server_selection_timeout_ms("999999999"), MAX_SERVER_SELECTION_TIMEOUT_MS)


class MongoClientKwargsTests(unittest.TestCase):
    def test_no_setting_gives_empty_kwargs(self):
        self.assertEqual(mongo_client_kwargs({}), {})

    def test_setting_is_forwarded_under_the_driver_name(self):
        kwargs = mongo_client_kwargs({SERVER_SELECTION_TIMEOUT_ENV: "750"})
        self.assertEqual(kwargs, {"serverSelectionTimeoutMS": 750})

    def test_unrelated_variables_are_ignored(self):
        self.assertEqual(mongo_client_kwargs({"MONGO_URL": "mongodb://x"}), {})


class TestEnvironmentsFailFastTests(unittest.TestCase):
    """Les deux répertoires de tests doivent activer le délai court.

    Chaque fichier de tests posait son propre `MONGO_URL` via `setdefault` ;
    les conftest sont chargés avant, ils sont donc le bon endroit pour fixer
    le réglage une fois pour toutes.
    """

    ROOT = Path(__file__).resolve().parents[2]

    def test_both_conftests_set_a_short_timeout(self):
        for conftest in (self.ROOT / "tests" / "conftest.py", self.ROOT / "backend" / "tests" / "conftest.py"):
            text = conftest.read_text(encoding="utf-8")
            self.assertIn(SERVER_SELECTION_TIMEOUT_ENV, text, f"{conftest} ne règle pas le délai Mongo")

    def test_running_suite_has_short_timeout(self):
        # Le réglage est effectif dans le processus qui exécute ce test.
        value = server_selection_timeout_ms(os.environ.get(SERVER_SELECTION_TIMEOUT_ENV))
        self.assertIsNotNone(value)
        assert value is not None
        self.assertLessEqual(value, 5_000)


class CiWorkflowsProvideMongoTests(unittest.TestCase):
    """Les jobs CI qui lancent pytest doivent fournir un MongoDB réel.

    Sans service `mongo`, les tests qui touchent la base passaient en avalant
    des erreurs de connexion : ils ne testaient plus ce qu'ils prétendaient.
    """

    ROOT = Path(__file__).resolve().parents[2]
    WORKFLOWS = (
        ".github/workflows/ci.yml",
        ".github/workflows/main-release-post-merge.yml",
        ".github/workflows/admin-dashboard-monitoring.yml",
    )

    def test_pytest_jobs_declare_a_mongo_service(self):
        for relative in self.WORKFLOWS:
            text = (self.ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("pytest", text)
            self.assertIn("image: mongo:", text, f"{relative} lance pytest sans service MongoDB")

    def test_ci_env_uses_the_variable_names_the_code_reads(self):
        # BUG-075 : la CI posait MONGODB_URI et JWT_SECRET, que le code ne lit
        # pas (il lit MONGO_URL et JWT_SECRET_KEY).
        for relative in self.WORKFLOWS:
            text = (self.ROOT / relative).read_text(encoding="utf-8")
            self.assertNotIn("MONGODB_URI", text, relative)
            self.assertNotIn("JWT_SECRET:", text, relative)
            self.assertIn("MONGO_URL:", text, relative)
            self.assertIn("JWT_SECRET_KEY:", text, relative)
