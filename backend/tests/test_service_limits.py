import sys
from pathlib import Path

import asyncio
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from service_limits import build_external_services_quota_snapshot


class FakeCollection:
    def __init__(self, mapping: dict[tuple[str, str], int], api_count: int = 0):
        self.mapping = mapping
        self.api_count = api_count

    async def count_documents(self, query):
        service = query.get("service_name")
        if service is None:
            return self.api_count
        action = query.get("action_name", "")
        return self.mapping.get((service, action), 0)


def test_service_with_known_quota_and_usage(monkeypatch):
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "x")
    monkeypatch.setenv("SERVICE_LIMIT_GEMINI_OCR_REQUESTS_PER_MONTH", "100")
    payload = asyncio.run(build_external_services_quota_snapshot(
        service_usage_logs_col=FakeCollection({("ocr", "receipt_scan"): 50}),
        api_request_logs_col=FakeCollection({}, api_count=10),
    ))
    ocr = next(item for item in payload["services"] if item["service_key"] == "gemini_ocr")
    assert ocr["usage_current_period"] == 50
    assert ocr["quota_limit_value"] == 100
    assert ocr["usage_percent"] == 50.0
    assert ocr["usage_remaining"] == 50
    assert ocr["status"] == "ok"


def test_service_with_known_quota_and_zero_usage(monkeypatch):
    monkeypatch.setenv("GEMINI_RECIPES_API_KEY", "x")
    monkeypatch.setenv("SERVICE_LIMIT_GEMINI_RECIPES_REQUESTS_PER_MONTH", "200")
    payload = asyncio.run(build_external_services_quota_snapshot(
        service_usage_logs_col=FakeCollection({("ai_recipes", "generate_recipes"): 0}),
        api_request_logs_col=FakeCollection({}, api_count=0),
    ))
    item = next(row for row in payload["services"] if row["service_key"] == "gemini_recipes")
    assert item["usage_current_period"] == 0
    assert item["usage_percent"] == 0.0
    assert item["usage_remaining"] == 200
    assert item["status"] == "ok"


def test_service_with_unknown_quota(monkeypatch):
    monkeypatch.delenv("SERVICE_LIMIT_OPENFOODFACTS_REQUESTS_PER_MONTH", raising=False)
    payload = asyncio.run(build_external_services_quota_snapshot(
        service_usage_logs_col=FakeCollection({("openfoodfacts", "product_lookup"): 7}),
        api_request_logs_col=FakeCollection({}, api_count=0),
    ))
    item = next(row for row in payload["services"] if row["service_key"] == "openfoodfacts")
    assert item["quota_limit_value"] is None
    assert item["usage_percent"] is None
    assert item["usage_remaining"] is None
    assert item["status"] == "unknown"


@pytest.mark.parametrize(
    ("usage", "expected_status", "expected_percent", "expected_remaining"),
    [
        (40, "ok", 40.0, 60),
        (80, "warning", 80.0, 20),
        (100, "critical", 100.0, 0),
        (120, "critical", 120.0, 0),
    ],
)
def test_status_thresholds_and_remaining(monkeypatch, usage, expected_status, expected_percent, expected_remaining):
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "x")
    monkeypatch.setenv("SERVICE_LIMIT_GEMINI_OCR_REQUESTS_PER_MONTH", "100")
    payload = asyncio.run(build_external_services_quota_snapshot(
        service_usage_logs_col=FakeCollection({("ocr", "receipt_scan"): usage}),
        api_request_logs_col=FakeCollection({}, api_count=0),
    ))
    item = next(row for row in payload["services"] if row["service_key"] == "gemini_ocr")
    assert item["status"] == expected_status
    assert item["usage_percent"] == expected_percent
    assert item["usage_remaining"] == expected_remaining


def test_service_with_known_quota_and_unknown_usage(monkeypatch):
    monkeypatch.setenv("SERVICE_LIMIT_BREVO_EMAILS_PER_DAY", "300")
    payload = asyncio.run(build_external_services_quota_snapshot(
        service_usage_logs_col=FakeCollection({}),
        api_request_logs_col=FakeCollection({}, api_count=0),
    ))
    item = next(row for row in payload["services"] if row["service_key"] == "brevo_email")
    assert item["quota_limit_value"] == 300
    assert item["usage_current_period"] is None
    assert item["status"] == "unknown"


def test_gemini_food_defaults_service_visible_with_usage(monkeypatch):
    # Pas de clé dédiée à configurer : la clé OCR existante suffit (cf.
    # food_defaults_service.py, réutilisation par défaut de GEMINI_OCR_API_KEY).
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "x")
    monkeypatch.setenv("SERVICE_LIMIT_GEMINI_FOOD_DEFAULTS_REQUESTS_PER_MONTH", "200")
    payload = asyncio.run(build_external_services_quota_snapshot(
        service_usage_logs_col=FakeCollection({("ai_food_defaults", "resolve_food_defaults"): 12}),
        api_request_logs_col=FakeCollection({}, api_count=0),
    ))
    item = next(row for row in payload["services"] if row["service_key"] == "gemini_food_defaults")
    assert item["configured"] is True
    assert item["usage_current_period"] == 12
    assert item["quota_limit_value"] == 200
    assert item["usage_remaining"] == 188
    assert item["status"] == "ok"


def test_payload_serialization_stable(monkeypatch):
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "x")
    monkeypatch.setenv("SERVICE_LIMIT_GEMINI_OCR_REQUESTS_PER_MONTH", "100")
    payload = asyncio.run(build_external_services_quota_snapshot(
        service_usage_logs_col=FakeCollection({("ocr", "receipt_scan"): 1}),
        api_request_logs_col=FakeCollection({}, api_count=0),
    ))
    assert set(payload.keys()) == {"generated_at", "services", "comparison_chart", "notes"}
    assert isinstance(payload["services"], list)
    assert isinstance(payload["comparison_chart"], list)
