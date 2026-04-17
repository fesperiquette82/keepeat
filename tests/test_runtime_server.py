from backend.runtime_server import DEFAULT_BIND_PORT, resolve_bind_port


def test_resolve_bind_port_uses_default_when_missing():
    assert resolve_bind_port(None) == DEFAULT_BIND_PORT


def test_resolve_bind_port_uses_default_when_invalid_text():
    assert resolve_bind_port("not-a-port") == DEFAULT_BIND_PORT


def test_resolve_bind_port_uses_default_when_out_of_range():
    assert resolve_bind_port("70000") == DEFAULT_BIND_PORT


def test_resolve_bind_port_accepts_valid_port():
    assert resolve_bind_port("10000") == 10000
