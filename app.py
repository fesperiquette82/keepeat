"""Application entry point for Render deployment.

Configures sys.path to make the backend package importable,
then exports the FastAPI application for Render to discover.
"""

import sys
from pathlib import Path

# Configure sys.path so imports work from the Render container root
# Working directory: /opt/render/project/
# This file: /opt/render/project/app.py
# src/backend/server.py: /opt/render/project/src/backend/server.py
# We need to add /opt/render/project/src to sys.path so 'backend' is importable
src_dir = Path(__file__).parent / 'src'
sys.path.insert(0, str(src_dir))

# Now import and expose the app for Render to discover
from backend.server import app

__all__ = ['app']
