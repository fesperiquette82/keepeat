#!/usr/bin/env bash
set -euo pipefail

E2E_RESET_SEED_BASE_URL="${E2E_RESET_SEED_BASE_URL:-http://127.0.0.1:8000}"
E2E_ANDROID_APP_ID="${E2E_ANDROID_APP_ID:-com.fesperiquette.keepeat}"

adb install -r e2e-apk/app-debug.apk
mkdir -p maestro-results

ensure_emulator_ready() {
  echo "==> Verifying emulator connectivity"
  adb wait-for-device
  adb devices -l || true
}

stabilize_between_flows() {
  ensure_emulator_ready
  adb shell input keyevent 3 || true
  adb shell am force-stop "$E2E_ANDROID_APP_ID" || true
  adb shell am force-stop dev.mobile.maestro || true
  sleep 2
}

while IFS= read -r flow_file; do
  stabilize_between_flows

  flow_name="$(basename "$flow_file" .yaml)"
  mode="seeded"
  if [ "$flow_name" = "03-stock-empty-state" ]; then
    mode="empty"
  fi

  echo "==> Running flow: $flow_name (mode=$mode)"
  echo "==> Preparing state for $flow_name (mode=$mode)"
  node scripts/e2e-reset-seed.mjs --mode "$mode" --base-url "$E2E_RESET_SEED_BASE_URL"
  if ! ~/.maestro/bin/maestro test "$flow_file" --format junit --output "maestro-results/$flow_name"; then
    echo "❌ Maestro flow failed: $flow_name"
    echo "==> adb devices state on failure"
    adb devices -l || true
    echo "==> Capturing emulator logcat on failure"
    adb logcat -d > emulator-logcat.txt || true
    echo "==> Current Maestro results tree"
    find maestro-results -maxdepth 3 -type f | sort || true
    if [ -f backend-e2e.log ]; then
      echo "==> backend-e2e.log tail"
      tail -n 200 backend-e2e.log || true
    fi
    exit 1
  fi
done < <(find .maestro -maxdepth 1 -name '*.yaml' ! -name 'config.yaml' | sort)

adb logcat -d > emulator-logcat.txt || true
