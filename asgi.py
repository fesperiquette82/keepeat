"""ASGI entry point for production deployment.

Used by uvicorn in Render deployment. Requires PYTHONPATH to include the project root.
Set in render.yaml: env.PYTHONPATH = .
"""
from backend.server import app

if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
