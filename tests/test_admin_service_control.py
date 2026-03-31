import asyncio
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from admin_service_control import build_cost_recommendations, build_services_status, build_usage_metrics


class _FakeDB:
    async def command(self, cmd):
        _ = cmd
        return {"ok": 1}


class _FakeApiLogsCol:
    async def count_documents(self, query):
        if query.get("status_code"):
            return 0
        return 42


class _FakeUsersCol:
    async def count_documents(self, query):
        if query == {}:
            return 12
        return 0


class _FakeStockCol:
    async def count_documents(self, query):
        if query == {}:
            return 140
        if query == {"status": "active"}:
            return 95
        return 0


class _FakeServiceUsageCol:
    async def count_documents(self, query):
        if query.get("service_name") == "ocr":
            return 10
        if query.get("service_name") == "openfoodfacts":
            return 31
        return 0


class AdminServiceControlTests(unittest.TestCase):
    def test_services_status_shape(self):
        async def _run():
            return await build_services_status(db=_FakeDB(), api_request_logs_col=_FakeApiLogsCol())

        payload = asyncio.run(_run())
        self.assertIn("services", payload)
        self.assertGreaterEqual(len(payload["services"]), 4)

    def test_usage_and_costs_payload(self):
        async def _run():
            usage = await build_usage_metrics(
                users_col=_FakeUsersCol(),
                stock_col=_FakeStockCol(),
                service_usage_logs_col=_FakeServiceUsageCol(),
            )
            costs = await build_cost_recommendations(usage_payload=usage)
            return usage, costs

        usage, costs = asyncio.run(_run())
        self.assertTrue(any(item["service_id"] == "ocr_engine" for item in usage["usage"]))
        self.assertTrue(any(item["service_id"] == "mongodb" for item in costs["costs"]))


if __name__ == "__main__":
    unittest.main()
