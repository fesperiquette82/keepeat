"""ASGI entry point for production deployment.

Ensures that backend.server can be imported correctly regardless of working directory.
Used by uvicorn in Render deployment.
"""
import sys
from pathlib import Path

# Ensure current directory is in sys.path for backend imports to resolve
sys.path.insert(0, str(Path(__file__).parent))

from backend.server import app

if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
