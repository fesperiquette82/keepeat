import os

DEFAULT_BIND_PORT = 10000


def resolve_bind_port(raw_port: str | None) -> int:
    """Return a safe TCP port for web runtime binding."""
    if raw_port is None:
        return DEFAULT_BIND_PORT

    candidate = raw_port.strip()
    if not candidate:
        return DEFAULT_BIND_PORT

    try:
        port = int(candidate)
    except ValueError:
        return DEFAULT_BIND_PORT

    if port <= 0 or port > 65535:
        return DEFAULT_BIND_PORT

    return port


def get_bind_port_from_env() -> int:
    """Resolve bind port from Render-style env vars with safe fallback."""
    return resolve_bind_port(os.getenv("PORT"))
