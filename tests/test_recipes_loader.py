import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from recipes_service import RecipeCatalogError, clear_recipe_catalog_cache, load_local_recipes, load_recipe_catalog


class RecipeLoaderTests(unittest.TestCase):
    def tearDown(self) -> None:
        clear_recipe_catalog_cache()

    def _write_catalog(self, payload) -> str:
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        json.dump(payload, handle, ensure_ascii=False)
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        return handle.name

    def test_load_local_recipes_reads_valid_catalog(self):
        path = self._write_catalog([
            {
                "id": "fr_test_omelette",
                "title": "Omelette test",
                "summary": "Résumé",
                "ingredients_required": ["oeuf"],
                "ingredients_optional": [],
                "steps": ["Battre et cuire."],
                "prep_time_min": 5,
                "cook_time_min": 5,
                "difficulty": "easy",
                "tags": ["rapide"],
                "meal_type": ["lunch"],
                "cuisine": "française",
                "servings": 2,
            }
        ])

        recipes = load_local_recipes(path)

        self.assertEqual(len(recipes), 1)
        self.assertEqual(recipes[0].id, "fr_test_omelette")
        self.assertEqual(recipes[0].meal_type[0].value, "lunch")

    def test_load_local_recipes_rejects_missing_file(self):
        with self.assertRaises(RecipeCatalogError):
            load_local_recipes("/tmp/does-not-exist-recipes.json")

    def test_load_local_recipes_rejects_invalid_json(self):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        handle.write("{invalid")
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))

        with self.assertRaises(RecipeCatalogError):
            load_local_recipes(handle.name)

    def test_load_local_recipes_rejects_directory_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(RecipeCatalogError):
                load_local_recipes(temp_dir)

    def test_load_local_recipes_rejects_duplicate_ids(self):
        duplicate_recipe = {
            "id": "fr_duplicate",
            "title": "Recette dupliquée",
            "summary": "Résumé",
            "ingredients_required": ["oeuf"],
            "ingredients_optional": [],
            "steps": ["Cuire."],
            "prep_time_min": 1,
            "cook_time_min": 1,
            "difficulty": "easy",
            "tags": ["test"],
            "meal_type": ["lunch"],
            "cuisine": "française",
            "servings": 1,
        }
        path = self._write_catalog([duplicate_recipe, duplicate_recipe])

        with self.assertRaises(RecipeCatalogError):
            load_local_recipes(path)

    def test_load_recipe_catalog_returns_list_of_recipes(self):
        path = self._write_catalog([
            {
                "id": "fr_test_soupe",
                "title": "Soupe test",
                "summary": "Résumé",
                "ingredients_required": ["carotte"],
                "ingredients_optional": ["crème"],
                "steps": ["Cuire.", "Mixer."],
                "prep_time_min": 10,
                "cook_time_min": 20,
                "difficulty": "easy",
                "tags": ["soir"],
                "meal_type": ["dinner"],
                "cuisine": "française",
                "servings": 2,
            }
        ])

        recipes = load_recipe_catalog(path)

        self.assertIsInstance(recipes, list)
        self.assertEqual(len(recipes), 1)
        self.assertEqual(recipes[0].title, "Soupe test")


if __name__ == "__main__":
    unittest.main()
