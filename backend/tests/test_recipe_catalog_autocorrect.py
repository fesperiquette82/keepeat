import json
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

from recipes_service import load_local_recipes


def test_load_local_recipes_autocorrects_common_french_typos(tmp_path):
    catalog_path = tmp_path / "catalog.json"
    payload = [
        {
            "id": "accent-fix-demo",
            "title": "Pancakes a l'agave",
            "summary": "Un porridge cremeux ideal pour le petit-dejeuner.",
            "ingredients_required": ["oeuf"],
            "ingredients_optional": [],
            "steps": ["Melanger la pate avec une cuillere de creme."],
            "prep_time_min": 5,
            "cook_time_min": 8,
            "difficulty": "easy",
            "tags": ["gouter"],
            "meal_type": ["breakfast"],
            "cuisine": "française",
            "servings": 1,
            "search_terms": ["oeufs", "petit-dejeuner"],
            "compat": {"storage_focus": ["frigo"]},
            "source": {"type": "local_catalog", "name": "keepeat"},
            "version": 1,
        }
    ]
    catalog_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    recipes = load_local_recipes(str(catalog_path))
    recipe = recipes[0]

    assert recipe.title == "Pancakes à l'agave"
    assert recipe.summary == "Un porridge crémeux idéal pour le petit-déjeuner."
    assert recipe.steps[0] == "Mélanger la pâte avec une cuillère de crème."
    assert recipe.tags == ["goûter"]
    assert recipe.search_terms == ["œufs", "petit-déjeuner"]
