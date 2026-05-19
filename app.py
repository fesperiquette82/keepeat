"""Application entry point for Render deployment.

Configures sys.path to make the backend package importable,
then exports the FastAPI application for Render to discover.
"""

import sys
from pathlib import Path

# Configure sys.path so imports work from the Render container
project_root = Path(__file__).parent

# Try adding src directory first (for Render's src layout), then project root (for local layout)
src_dir = project_root / 'src'
if src_dir.exists():
    sys.path.insert(0, str(src_dir))
else:
    # Fallback: add project root so backend/ is importable
    sys.path.insert(0, str(project_root))

# Now import and expose the app for Render to discover
from backend.server import app

__all__ = ['app']
