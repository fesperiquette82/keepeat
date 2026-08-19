"""Tests de non-régression — recettes : MongoDB source de vérité à l'exécution.

Avant correction :
  1. Les recettes ajoutées par l'IA (_save_ai_recipe_to_stores) ou par l'admin
     (admin_add_recipe, admin_import_recipes) étaient écrites à la fois dans
     MongoDB ET dans backend/data/recipes.catalog.json — un fichier versionné en
     git, sur le disque ÉPHÉMÈRE de Render (aucun volume persistant dans
     render.yaml). Chaque redéploiement écrasait le fichier par le contenu du
     dépôt : toute recette ajoutée là à l'exécution était silencieusement perdue
     au déploiement suivant, malgré la double écriture qui donnait l'illusion
     d'une persistance.
  2. _seed_shared_recipes_collection_if_needed ne s'exécutait qu'une seule fois
     (dès que la collection `recipes` contenait un seul document, il se
     désactivait pour toujours). Une correction apportée au catalogue git
     n'atteignait donc plus jamais MongoDB après le tout premier déploiement.

Correction :
  1. Les trois sites d'écriture n'écrivent plus le catalogue JSON à l'exécution :
     MongoDB (recipes_col) en devient l'unique source de vérité.
  2. _sync_shared_recipes_collection_from_catalog synchronise chaque recette du
     catalogue par upsert (sur `id`), à CHAQUE démarrage — les corrections du
     catalogue git atteignent réellement la prod à chaque déploiement, sans
     écraser les compteurs d'usage ni les recettes ajoutées hors catalogue.
"""
import asyncio
import importlib
import inspect
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    for mod in ("server", "models", "recipes_service"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


def _make_recipe(recipe_id: str, title: str):
    from models import Recipe, RecipeCuisine, RecipeDifficulty, RecipeMealType
    return Recipe.model_validate({
        "id": recipe_id,
        "title": title,
        "summary": "Résumé de test",
        "ingredients_required": ["tomate"],
        "ingredients_optional": [],
        "steps": ["Cuire."],
        "prep_time_min": 10,
        "cook_time_min": 5,
        "difficulty": RecipeDifficulty.easy.value,
        "tags": ["rapide"],
        "meal_type": [RecipeMealType.dinner.value],
        "cuisine": RecipeCuisine.francaise.value,
        "servings": 2,
    })


# ---------------------------------------------------------------------------
# Finding 1 — plus d'écriture runtime dans le catalogue JSON
# ---------------------------------------------------------------------------

class TestNoRuntimeCatalogJsonWrites:
    def test_append_recipe_to_catalog_no_longer_imported_in_server(self, monkeypatch):
        """Verrou plomberie : server.py ne doit plus importer append_recipe_to_catalog
        (sans cet import, aucun des 3 sites d'écriture ne peut plus l'appeler)."""
        server = _load_server(monkeypatch)
        assert not hasattr(server, "append_recipe_to_catalog")

    def test_save_ai_recipe_source_has_no_catalog_write(self, monkeypatch):
        server = _load_server(monkeypatch)
        source = inspect.getsource(server._save_ai_recipe_to_stores)
        assert "append_recipe_to_catalog" not in source

    def test_admin_add_recipe_source_has_no_catalog_write(self, monkeypatch):
        server = _load_server(monkeypatch)
        source = inspect.getsource(server.admin_add_recipe)
        assert "append_recipe_to_catalog" not in source

    def test_admin_import_recipes_source_has_no_catalog_write(self, monkeypatch):
        server = _load_server(monkeypatch)
        source = inspect.getsource(server.admin_import_recipes)
        assert "append_recipe_to_catalog" not in source

    def test_save_ai_recipe_persists_only_via_mongodb(self, monkeypatch):
        """Exécution réelle de _save_ai_recipe_to_stores avec seule recipes_col
        mockée : doit réussir sans toucher au système de fichiers du catalogue."""
        server = _load_server(monkeypatch)

        recipes_col = MagicMock()
        recipes_col.insert_one = AsyncMock()
        monkeypatch.setattr(server, "recipes_col", recipes_col)
        monkeypatch.setattr(server, "_mark_coverable_gaps_after_recipe_insert", AsyncMock())

        ai_recipe = {
            "title": "Poulet rôti",
            "ingredients_used": ["poulet", "carotte"],
            "instructions_summary": "Cuire au four 40 minutes.",
            "prep_time_min": 40,
        }
        result = asyncio.run(server._save_ai_recipe_to_stores(ai_recipe, stock_names=["poulet", "carotte"]))

        recipes_col.insert_one.assert_awaited_once()
        assert result["title"] == "Poulet rôti"


# ---------------------------------------------------------------------------
# Finding 2 — synchronisation idempotente du catalogue (upsert par recette)
# ---------------------------------------------------------------------------

class TestCatalogSyncIsIdempotentPerRecipe:
    def test_new_recipe_upserted_with_zero_usage_count(self, monkeypatch):
        server = _load_server(monkeypatch)
        recipe = _make_recipe("cat-1", "Tarte tomate")
        monkeypatch.setattr(server, "load_local_recipes", lambda: (recipe,))

        col = MagicMock()
        col.update_one = AsyncMock()
        monkeypatch.setattr(server, "recipes_col", col)

        asyncio.run(server._sync_shared_recipes_collection_from_catalog())

        col.update_one.assert_awaited_once()
        args, kwargs = col.update_one.call_args
        filt, update = args
        assert filt == {"_id": "cat-1"}
        assert update["$set"]["title"] == "Tarte tomate"
        assert update["$set"]["is_active"] is True
        assert update["$setOnInsert"]["usage_count"] == 0
        assert update["$setOnInsert"]["view_count"] == 0
        assert kwargs.get("upsert") is True

    def test_sync_runs_even_when_collection_already_populated(self, monkeypatch):
        """BUG corrigé : l'ancien seed s'arrêtait dès que la collection contenait
        1 document (count_documents > 0 → return immédiat). La synchronisation
        doit tourner à chaque démarrage, quel que soit l'état de la collection."""
        server = _load_server(monkeypatch)
        recipe = _make_recipe("cat-2", "Soupe")
        monkeypatch.setattr(server, "load_local_recipes", lambda: (recipe,))

        col = MagicMock()
        col.update_one = AsyncMock()
        col.count_documents = AsyncMock(return_value=500)  # collection déjà pleine
        monkeypatch.setattr(server, "recipes_col", col)

        asyncio.run(server._sync_shared_recipes_collection_from_catalog())

        col.update_one.assert_awaited_once()  # tourne quand même : plus de court-circuit
        col.count_documents.assert_not_awaited()  # la décision ne dépend plus de ce compteur

    def test_content_update_never_resets_usage_counters(self, monkeypatch):
        """Les compteurs d'usage / la date de création ne doivent être fixés que
        via $setOnInsert (jamais écrasés par $set sur un document existant)."""
        server = _load_server(monkeypatch)
        recipe = _make_recipe("cat-3", "Gratin")
        monkeypatch.setattr(server, "load_local_recipes", lambda: (recipe,))

        col = MagicMock()
        col.update_one = AsyncMock()
        monkeypatch.setattr(server, "recipes_col", col)

        asyncio.run(server._sync_shared_recipes_collection_from_catalog())

        _, update = col.update_one.call_args[0]
        assert "usage_count" not in update["$set"]
        assert "view_count" not in update["$set"]
        assert "created_at" not in update["$set"]

    def test_sync_only_touches_ids_present_in_local_catalog(self, monkeypatch):
        """Les recettes ajoutées hors catalogue (IA, admin) ne portent pas d'id du
        catalogue local : une synchronisation sur 1 seule recette locale ne doit
        générer qu'1 seul upsert, jamais un balayage de toute la collection."""
        server = _load_server(monkeypatch)
        recipe = _make_recipe("cat-4", "Ratatouille")
        monkeypatch.setattr(server, "load_local_recipes", lambda: (recipe,))

        col = MagicMock()
        col.update_one = AsyncMock()
        col.delete_many = AsyncMock()
        monkeypatch.setattr(server, "recipes_col", col)

        asyncio.run(server._sync_shared_recipes_collection_from_catalog())

        assert col.update_one.await_count == 1
        col.delete_many.assert_not_awaited()

    def test_sync_failure_is_swallowed_and_does_not_crash_startup(self, monkeypatch):
        """Comme l'ancien seed, une panne (Mongo indisponible, catalogue invalide)
        ne doit pas empêcher le démarrage du backend."""
        server = _load_server(monkeypatch)
        monkeypatch.setattr(server, "load_local_recipes", lambda: (_ for _ in ()).throw(RuntimeError("catalog broken")))

        col = MagicMock()
        col.update_one = AsyncMock()
        monkeypatch.setattr(server, "recipes_col", col)

        asyncio.run(server._sync_shared_recipes_collection_from_catalog())  # ne doit pas lever
        col.update_one.assert_not_awaited()
