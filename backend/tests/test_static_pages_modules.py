"""Tests de non-régression — pages HTML statiques sorties de server.py (BUG-087).

`server.py` portait 1 600 lignes de HTML et de JavaScript en ligne (cinq pages :
politique de confidentialité, suppression de compte, trois pages admin), soit
un cinquième du fichier. Elles vivent désormais dans `backend/legal_pages.py`
et `backend/admin_pages.py` ; `server.py` ne fait que les servir.

Couverture :
  - chaque route sert exactement le contenu du module dédié, en text/html ;
  - `server.py` ne contient plus aucune page HTML complète en ligne.
"""
import ast
import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


PAGES = [
    ("/privacy-policy", "backend.legal_pages", "PRIVACY_POLICY_HTML"),
    ("/account-deletion", "backend.legal_pages", "ACCOUNT_DELETION_HTML"),
    ("/admin/recipes", "backend.admin_pages", "ADMIN_RECIPES_HTML"),
    ("/admin/tickets", "backend.admin_pages", "ADMIN_TICKETS_HTML"),
    ("/admin/dashboard", "backend.admin_pages", "ADMIN_DASHBOARD_HTML"),
]


@pytest.mark.parametrize(("path", "module_name", "constant"), PAGES)
def test_route_serves_page_from_dedicated_module(monkeypatch, path, module_name, constant):
    server = _load_server(monkeypatch)
    expected = getattr(importlib.import_module(module_name), constant)
    assert expected.startswith("<!DOCTYPE html>")

    resp = TestClient(server.app).get(path)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert resp.text == expected


def test_server_module_holds_no_inline_html_page():
    tree = ast.parse((BACKEND_DIR / "server.py").read_text(encoding="utf-8"))
    inline_pages = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.lstrip().lower().startswith("<!doctype html")
    ]
    assert inline_pages == [], f"page HTML en ligne dans server.py, lignes {inline_pages}"
