"""Pytest configuration for backend tests.

Adds the backend directory to sys.path so that direct imports like
'from app_core import ...' work correctly when running tests.
"""
import sys
from pathlib import Path

# Add backend directory to sys.path for imports within backend modules
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
