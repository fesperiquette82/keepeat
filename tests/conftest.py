"""Pytest configuration for keepeat tests.

Adds the keepeat root directory to sys.path so that package imports work correctly.
"""
import sys
from pathlib import Path

# Add keepeat root to sys.path for package imports like 'from backend.alerts import ...'
root_dir = Path(__file__).resolve().parents[1]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
