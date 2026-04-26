#!/usr/bin/env bash
set -euo pipefail

E2E_RESET_SEED_BASE_URL="${E2E_RESET_SEED_BASE_URL:-http://127.0.0.1:8000}"
E2E_ANDROID_APP_ID="${E2E_ANDROID_APP_ID:-com.fesperiquette.keepeat}"
MAESTRO_SUITE="full"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --suite)
      MAESTRO_SUITE="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$MAESTRO_SUITE" ]; then
  echo "Missing value for --suite" >&2
  exit 2
fi

if [ "$MAESTRO_SUITE" != "smoke" ] && [ "$MAESTRO_SUITE" != "full" ]; then
  echo "Unsupported suite: $MAESTRO_SUITE (expected: smoke|full)" >&2
  exit 2
fi

adb install -r e2e-apk/app-debug.apk

ensure_emulator_ready() {
  echo "==> Verifying emulator connectivity"
  adb wait-for-device
  adb devices -l || true
}

wait_for_boot_completed() {
  echo "==> Waiting for Android boot completion (sys.boot_completed=1)"
  local boot_completed=""
  for _ in $(seq 1 30); do
    boot_completed="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    if [ "$boot_completed" = "1" ]; then
      echo "==> Android boot completed"
      return 0
    fi
    sleep 2
  done

  echo "Android emulator did not report sys.boot_completed=1 in time" >&2
  adb devices -l || true
  adb logcat -d | tail -n 200 || true
  return 1
}

ensure_apk_installed() {
  echo "==> Verifying APK installation for $E2E_ANDROID_APP_ID"
  if ! adb shell pm list packages "$E2E_ANDROID_APP_ID" | tr -d '\r' | grep -q "package:$E2E_ANDROID_APP_ID"; then
    echo "APK package $E2E_ANDROID_APP_ID is not installed" >&2
    adb shell pm list packages | head -n 50 || true
    return 1
  fi
}

ensure_emulator_ready
wait_for_boot_completed
ensure_apk_installed
sleep 8

mkdir -p maestro-results

FLOW_FILES=()
if [ "$MAESTRO_SUITE" = "smoke" ]; then
  FLOW_FILES=(
    ".maestro/00-smoke-launch.yaml"
    ".maestro/01-auth-session.yaml"
    ".maestro/02-navigation-main-tabs.yaml"
  )
else
  while IFS= read -r flow_file; do
    FLOW_FILES+=("$flow_file")
  done < <(find .maestro -maxdepth 1 -name '*.yaml' ! -name 'config.yaml' | sort)
fi

if [ "${#FLOW_FILES[@]}" -eq 0 ]; then
  echo "No Maestro flows selected for suite=$MAESTRO_SUITE" >&2
  exit 1
fi

stabilize_between_flows() {
  ensure_emulator_ready
  adb shell input keyevent 3 || true
  adb shell am force-stop "$E2E_ANDROID_APP_ID" || true
  adb shell am force-stop dev.mobile.maestro || true
  sleep 2
}

for flow_file in "${FLOW_FILES[@]}"; do
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
done

adb logcat -d > emulator-logcat.txt || true
