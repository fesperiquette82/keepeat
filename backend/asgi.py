"""ASGI entry point for production deployment.

Configures sys.path to ensure backend package is importable,
then launches the FastAPI application with uvicorn.
"""

import os
import sys
from pathlib import Path

# Get the project root directory
# When called from render with startCommand: python -u src/backend/asgi.py
# __file__ could be either:
# - Relative: src/backend/asgi.py
# - Absolute: /opt/render/project/src/backend/asgi.py
script_path = Path(__file__).resolve()
# Go up 3 levels: src/backend/asgi.py -> src/backend/ -> src/ -> project_root
project_root = script_path.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.server import app

if __name__ == '__main__':
    import uvicorn
    port = int(os.environ.get('PORT', 8000))
    uvicorn.run(app, host='0.0.0.0', port=port)
