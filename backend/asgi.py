"""ASGI entry point for production deployment.

Configures sys.path to ensure backend package is importable,
then launches the FastAPI application with uvicorn.
"""

import sys
from pathlib import Path

# Add parent directory (project root) to sys.path so 'backend' package is importable
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.server import app

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
