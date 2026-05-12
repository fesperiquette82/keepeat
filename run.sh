#!/bin/bash
# Startup script for Render deployment
# Ensures PYTHONPATH is set correctly before uvicorn starts

cd "$(dirname "$0")"
export PYTHONPATH="${PWD}:${PYTHONPATH}"
exec python -m uvicorn asgi:app --host 0.0.0.0 --port "${PORT:-10000}"
