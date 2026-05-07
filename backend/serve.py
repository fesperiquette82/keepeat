import uvicorn

from runtime_server import get_bind_port_from_env
from server import app, logger


if __name__ == "__main__":
    bind_port = get_bind_port_from_env()
    logger.info("Starting server with bind port %s", bind_port)
    uvicorn.run(app, host="0.0.0.0", port=bind_port)
