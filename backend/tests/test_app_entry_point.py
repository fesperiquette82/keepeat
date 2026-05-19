"""Tests for application entry point to ensure proper initialization."""

import sys
from pathlib import Path


def test_app_module_imports_without_error():
    """Verify app.py can be imported from project root and exposes the FastAPI app."""
    # Get the app.py file from project root
    project_root = Path(__file__).parent.parent.parent
    app_path = project_root / 'app.py'
    assert app_path.exists(), f'app.py not found at {app_path}'

    # Verify it can be imported
    import importlib.util
    spec = importlib.util.spec_from_file_location('app', app_path)
    app_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app_module)

    # Verify the FastAPI app is accessible
    assert hasattr(app_module, 'app'), 'app module should expose "app"'
    assert app_module.app is not None, 'app should not be None'
