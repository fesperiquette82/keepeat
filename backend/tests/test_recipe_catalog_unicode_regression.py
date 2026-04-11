from pathlib import Path
import json


def _catalog_by_id() -> dict[str, dict]:
    path = Path(__file__).resolve().parents[1] / "data" / "recipes.catalog.json"
    recipes = json.loads(path.read_text(encoding="utf-8"))
    return {recipe["id"]: recipe for recipe in recipes}


def test_catalog_keeps_french_accents_for_recent_manual_recipes():
    by_id = _catalog_by_id()

    assert by_id["fr_pancakes_agave"]["title"] == "Pancakes à l'agave"
    assert "petit-déjeuner" in by_id["fr_pancakes_agave"]["summary"]

    assert by_id["manual-oeufs-brouilles-foie-de-morue-et-olives"]["title"].startswith("Œufs brouillés")
    assert "œufs brouillés" in by_id["manual-oeufs-brouilles-foie-de-morue-et-olives"]["summary"]

    assert by_id["manual-spirales-creme-pistache-et-olivade"]["title"] == "Spirales crème pistache et olivade"
    assert "crémeuse" in by_id["manual-spirales-creme-pistache-et-olivade"]["summary"]
    assert "crémeux" in by_id["manual-spirales-creme-pistache-et-olivade"]["tags"]

    assert by_id["manual-creme-dessert-pomme-poire-vanille-amande"]["title"].startswith("Crème dessert")
    assert "goûter" in by_id["manual-creme-dessert-pomme-poire-vanille-amande"]["tags"]
