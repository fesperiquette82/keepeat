"""Tests for ASGI entry point to ensure proper initialization."""

import sys
from pathlib import Path


def test_asgi_module_imports_without_error():
    """Verify asgi.py can be imported and exposes the app."""
    # Get the asgi.py file
    asgi_path = Path(__file__).parent.parent / 'asgi.py'
    assert asgi_path.exists(), f'asgi.py not found at {asgi_path}'

    # Verify it can be imported (simulating what Render does)
    import importlib.util
    spec = importlib.util.spec_from_file_location('asgi', asgi_path)
    asgi_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(asgi_module)

    # Verify the FastAPI app is accessible
    assert hasattr(asgi_module, 'app'), 'asgi module should expose "app"'
    assert asgi_module.app is not None, 'app should not be None'
