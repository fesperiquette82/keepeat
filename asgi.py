"""ASGI entry point for production deployment.

Ensures that backend.server can be imported correctly regardless of working directory.
Used by uvicorn in Render deployment.

Uses dynamic imports (importlib) because static imports are resolved at module load time,
before sys.path can be modified. This ensures backend package is in sys.path before
any relative import resolution happens.
"""
import sys
from pathlib import Path

# Add current directory to sys.path BEFORE any other code
project_root = str(Path(__file__).parent.resolve())
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Use dynamic import to ensure sys.path is ready
import importlib
server_module = importlib.import_module('backend.server')
app = server_module.app

if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
