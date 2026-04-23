"""Tests de non-régression — BUG-007 : race condition sur append_recipe_to_catalog.

Vérifie que deux appels concurrents n'écrasent pas mutuellement leurs données
grâce au verrou _catalog_write_lock (threading.Lock).
"""
import json
import sys
import threading
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from recipes_service import append_recipe_to_catalog, _catalog_write_lock


def _make_recipe(title: str) -> dict:
    return {
        "id": title,
        "title": title,
        "ingredients_keywords": ["tomate"],
        "steps": [],
        "duration_min": 10,
        "difficulty": "facile",
        "meal_type": ["plat"],
        "tags": [],
        "version": 1,
    }


def test_append_sequential_preserves_both_entries(tmp_path):
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps([]), encoding="utf-8")

    append_recipe_to_catalog(_make_recipe("RecetteA"), catalog_path=catalog)
    append_recipe_to_catalog(_make_recipe("RecetteB"), catalog_path=catalog)

    result = json.loads(catalog.read_text(encoding="utf-8"))
    titles = [r["title"] for r in result]
    assert "RecetteA" in titles
    assert "RecetteB" in titles
    assert len(result) == 2


def test_append_concurrent_preserves_all_entries(tmp_path):
    """BUG-007 : deux threads concurrents ne doivent pas s'écraser mutuellement."""
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps([]), encoding="utf-8")

    errors: list[Exception] = []

    def worker(title: str) -> None:
        try:
            append_recipe_to_catalog(_make_recipe(title), catalog_path=catalog)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(f"Recette{i}",)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Exceptions dans les threads : {errors}"
    result = json.loads(catalog.read_text(encoding="utf-8"))
    assert len(result) == 10, f"Attendu 10 recettes, obtenu {len(result)} → perte de données"


def test_catalog_write_lock_is_threading_lock():
    """Vérifie que le verrou est bien un threading.Lock (pas un objet factice)."""
    assert isinstance(_catalog_write_lock, type(threading.Lock()))
