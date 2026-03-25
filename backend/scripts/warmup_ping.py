#!/usr/bin/env python3
"""Ping de warm-up pour maintenir le backend actif et réduire les cold starts."""

from __future__ import annotations

import logging
import os
import time
from urllib import error, request

DEFAULT_BACKEND_URL = "http://localhost:8000"
DEFAULT_HEALTH_PATH = "/api/health"
DEFAULT_TIMEOUT_SECONDS = 3


def build_health_url() -> str:
    base_url = os.getenv("BACKEND_URL", DEFAULT_BACKEND_URL).rstrip("/")
    health_path = os.getenv("WARMUP_HEALTH_PATH", DEFAULT_HEALTH_PATH)
    if not health_path.startswith("/"):
        health_path = f"/{health_path}"
    return f"{base_url}{health_path}"


def run_ping(health_url: str, timeout_seconds: float) -> bool:
    started = time.perf_counter()
    req = request.Request(
        health_url,
        headers={"User-Agent": "KeepEat-Warmup/1.0"},
    )
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            body = response.read().decode("utf-8", errors="replace")
            elapsed_ms = (time.perf_counter() - started) * 1000
            if 200 <= response.status < 300:
                logging.info(
                    "Warmup ping success | status=%s | latency_ms=%.1f | body=%s",
                    response.status,
                    elapsed_ms,
                    body.strip()[:120],
                )
                return True
            logging.warning(
                "Warmup ping unexpected status | status=%s | latency_ms=%.1f | body=%s",
                response.status,
                elapsed_ms,
                body.strip()[:120],
            )
            return False
    except (error.HTTPError, error.URLError, TimeoutError, OSError) as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        logging.warning("Warmup ping failed | latency_ms=%.1f | error=%s", elapsed_ms, exc)
        return False


def main() -> None:
    logging.basicConfig(
        level=os.getenv("WARMUP_LOG_LEVEL", "INFO"),
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    health_url = build_health_url()
    timeout_seconds = float(os.getenv("WARMUP_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))

    logging.info(
        "Warmup ping started | health_url=%s | timeout_seconds=%s",
        health_url,
        timeout_seconds,
    )
    ok = run_ping(health_url, timeout_seconds)
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
