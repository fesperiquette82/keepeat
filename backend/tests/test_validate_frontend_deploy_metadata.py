from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "validate_frontend_deploy_metadata.py"
SPEC = importlib.util.spec_from_file_location("validate_frontend_deploy_metadata", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_build_frontend_build_info_url_prefers_explicit() -> None:
    url = MODULE.build_frontend_build_info_url("https://cdn.example.com/bi.json", "https://app.example.com")
    assert url == "https://cdn.example.com/bi.json"


def test_build_frontend_build_info_url_from_public_url() -> None:
    url = MODULE.build_frontend_build_info_url("", "https://app.example.com/")
    assert url == "https://app.example.com/build-info.json"


def test_validate_build_info_payload_rejects_unknowns() -> None:
    errors = MODULE.validate_build_info_payload({"commit": "unknown", "version": "", "build_time": "unknown"})
    assert len(errors) == 3


def test_validate_dashboard_frontend_payload_requires_current_commit_and_version() -> None:
    errors, warnings = MODULE.validate_dashboard_frontend_payload(
        {
            "frontend_deployment": {
                "current": {"commit": "unknown", "version": "unknown"},
                "expected": {"commit": "unknown"},
            }
        }
    )
    assert "dashboard.current.commit est inconnu" in errors
    assert "dashboard.current.version est inconnu" in errors
    assert "dashboard.expected.commit est inconnu" in warnings
