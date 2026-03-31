"""Migration MongoDB: crée les collections/indexes d'observabilité admin.

Usage:
    python backend/migrations/20260331_observability_collections.py
"""

from __future__ import annotations

import os

from motor.motor_asyncio import AsyncIOMotorClient


async def run() -> None:
    mongo_url = os.getenv("MONGO_URL")
    db_name = os.getenv("DB_NAME", "keepeat_db")
    if not mongo_url:
        raise RuntimeError("MONGO_URL is required")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    api_request_logs_col = db["api_request_logs"]
    business_events_col = db["business_events"]
    service_usage_logs_col = db["service_usage_logs"]
    daily_metrics_col = db["daily_metrics"]

    await api_request_logs_col.create_index([("created_at", -1)])
    await api_request_logs_col.create_index([("endpoint_key", 1), ("created_at", -1)])
    await api_request_logs_col.create_index([("status_code", 1), ("created_at", -1)])

    await business_events_col.create_index([("event_name", 1), ("created_at", -1)])
    await business_events_col.create_index([("user_id", 1), ("created_at", -1)])

    await service_usage_logs_col.create_index([("service_name", 1), ("created_at", -1)])
    await service_usage_logs_col.create_index([("plan_type_at_time", 1), ("created_at", -1)])

    await daily_metrics_col.create_index("date", unique=True)

    print("Observability migration done.")
    client.close()


if __name__ == "__main__":
    import asyncio

    asyncio.run(run())
