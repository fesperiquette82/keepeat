import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import server


class CriticalRegressionsTests(unittest.TestCase):
    def test_normalize_ingredient_name_compacts_spaces_and_strips_punctuation(self):
        value = server._normalize_ingredient_name("  Tomates!!!   fraîches  ")
        self.assertEqual(value, "tomates fraiche")

    def test_admin_recipes_post_route_is_declared_once(self):
        post_routes = [
            route
            for route in server.app.routes
            if getattr(route, "path", None) == "/api/admin/recipes"
            and "POST" in getattr(route, "methods", set())
        ]
        self.assertEqual(len(post_routes), 1)


if __name__ == "__main__":
    unittest.main()
