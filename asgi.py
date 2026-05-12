"""ASGI entry point for production deployment.

Explicitly adds the project root to sys.path before importing backend modules.
This ensures backend package can be found regardless of how the app is invoked.
"""
import sys
from pathlib import Path

# Add project root to sys.path BEFORE any relative imports
# This is needed because uvicorn calls import_from_string which may not inherit PYTHONPATH
project_root = str(Path(__file__).parent.resolve())
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Now import after sys.path is set
from backend.server import app

if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
