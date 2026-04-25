from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_mode import ensure_external_allowed, external_services_disabled, is_test_env, mock_openfoodfacts_enabled


def test_test_mode_flags_default_to_false(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DISABLE_EXTERNAL_SERVICES", raising=False)
    monkeypatch.delenv("MOCK_OPEN_FOOD_FACTS", raising=False)

    assert is_test_env() is False
    assert external_services_disabled() is False
    assert mock_openfoodfacts_enabled() is False


def test_test_mode_blocks_external_calls_when_disabled(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DISABLE_EXTERNAL_SERVICES", "true")

    with pytest.raises(RuntimeError):
        ensure_external_allowed("openfoodfacts")


def test_server_declares_test_seed_and_reset_routes():
    content = Path("backend/server.py").read_text(encoding="utf-8")

    assert '@api_router.post("/test/reset")' in content
    assert '@api_router.post("/test/seed")' in content
    assert "if not is_test_env():" in content


def test_server_blocks_external_services_in_test_mode():
    content = Path("backend/server.py").read_text(encoding="utf-8")

    assert 'ensure_external_allowed("emails")' in content
    assert 'ensure_external_allowed("billing")' in content
    assert 'ensure_external_allowed("openfoodfacts")' in content
    assert 'ensure_external_allowed("ocr")' in content
    assert "mock_push_enabled()" in content
