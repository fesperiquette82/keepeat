from pathlib import Path


def test_backend_server_uses_package_imports_for_internal_modules():
    server = Path("backend/server.py").read_text(encoding="utf-8")

    fragile_imports = [
        "from alerts import",
        "from app_core import",
        "from auth_utils import",
        "from models import",
        "from entitlements import",
        "from ocr_service import",
        "from priority_refresh import",
        "from observability import",
        "from admin_service_control import",
        "from service_limits import",
        "from product_catalog import",
        "from recipes_service import",
        "from test_mode import",
    ]

    for pattern in fragile_imports:
        assert pattern not in server

    robust_imports = [
        "from backend.alerts import",
        "from backend.app_core import",
        "from backend.auth_utils import",
        "from backend.models import",
        "from backend.entitlements import",
        "from backend.ocr_service import",
        "from backend.priority_refresh import",
        "from backend.observability import",
        "from backend.admin_service_control import",
        "from backend.service_limits import",
        "from backend.product_catalog import",
        "from backend.recipes_service import",
        "from backend.test_mode import",
    ]

    for pattern in robust_imports:
        assert pattern in server
