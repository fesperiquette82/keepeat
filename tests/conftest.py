"""Pytest configuration for keepeat tests.

Adds the keepeat root directory to sys.path so that package imports work correctly.
"""
import os
import sys
from pathlib import Path

# Add keepeat root to sys.path for package imports like 'from backend.alerts import ...'
root_dir = Path(__file__).resolve().parents[1]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

# BUG-075 : un MongoDB absent coûtait 30 s par opération (délai de sélection du
# pilote), soit 58 min de CI pour une suite qui en vaut 2. Les conftest sont
# chargés avant tout module de test : c'est ici que les valeurs par défaut de
# l'environnement de test se posent, une fois pour toutes. `setdefault` laisse
# la main à une valeur déjà présente (CI avec service mongo, poste de dev).
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "keepeat_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("MONGO_SERVER_SELECTION_TIMEOUT_MS", "500")


# BUG-075 (suite) : Motor fige la boucle asyncio du client à sa première
# opération (`AgnosticClient.io_loop`). Beaucoup de tests créent une boucle par
# test (`asyncio.run`, TestClient) : dès que la boucle d'origine est fermée,
# toute opération suivante échoue en « Event loop is closed » — et seulement
# selon l'ordre d'exécution des fichiers. On délie le client avant chaque test
# pour qu'il se rattache à la boucle courante.
import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _rebind_motor_client_to_current_loop():
    for module_name in ("server", "backend.server"):
        module = sys.modules.get(module_name)
        client = getattr(module, "client", None) if module else None
        if client is not None and hasattr(client, "_io_loop"):
            client._io_loop = None
    yield


# BUG-075 (suite) : plusieurs fichiers de tests rechargent `server` /
# `backend.server` (`sys.modules.pop` + `import_module`) pour tester un
# démarrage sous d'autres variables d'environnement. Ils laissent derrière eux
# un nouvel objet module dans `sys.modules` tandis que l'attribut
# `backend.server` (celui que `from backend import server` renvoie) pointe
# toujours vers l'ancien. Les tests suivants patchent alors un module et
# exercent l'autre : « Event loop is closed », uniquement selon l'ordre des
# fichiers. On remet les deux en cohérence à la fin de chaque module de tests.
@pytest.fixture(autouse=True, scope="module")
def _restore_server_modules_after_module():
    import backend

    snapshot = {name: sys.modules.get(name) for name in ("server", "backend.server")}
    yield
    for name, module in snapshot.items():
        if module is not None:
            sys.modules[name] = module
    current = sys.modules.get("backend.server")
    if current is not None:
        backend.server = current
