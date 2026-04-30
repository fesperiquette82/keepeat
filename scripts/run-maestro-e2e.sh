#!/usr/bin/env bash
set -euo pipefail

E2E_RESET_SEED_BASE_URL="${E2E_RESET_SEED_BASE_URL:-http://127.0.0.1:8000}"
E2E_ANDROID_APP_ID="${E2E_ANDROID_APP_ID:-com.fesperiquette.keepeat}"
MAESTRO_SUITE="full"
MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}"

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

ensure_emulator_ready() {
  echo "==> Verifying emulator connectivity"
  adb wait-for-device
  adb devices -l || true
}

forward_backend_to_emulator() {
  echo "==> Setting up port forwarding for backend"
  echo "Forwarding emulator localhost:8000 → runner backend 127.0.0.1:8000"
  if adb reverse tcp:8000 tcp:8000; then
    echo "✅ adb reverse tcp:8000 tcp:8000 succeeded"
  else
    echo "❌ adb reverse tcp:8000 tcp:8000 failed (non-blocking, app may use localhost)" >&2
  fi
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

wait_for_package_manager_ready() {
  echo "==> Waiting for Android Package Manager to be ready"
  local max_attempts=30
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    if adb shell cmd package list packages >/dev/null 2>&1; then
      echo "==> Android Package Manager is ready"
      return 0
    fi

    local attempt_msg="(attempt $attempt/$max_attempts)"
    if [ $((attempt % 5)) -eq 0 ]; then
      echo "  Package Manager not ready yet $attempt_msg, retrying..."
    fi

    sleep 1
    attempt=$((attempt + 1))
  done

  echo "Package Manager did not become ready within timeout ($max_attempts attempts)" >&2
  echo "Diagnostics:" >&2
  adb devices -l || true
  adb shell getprop sys.boot_completed 2>/dev/null || echo "  (sys.boot_completed unavailable)" >&2
  return 1
}

wait_for_settings_provider_ready() {
  echo "==> Waiting for Android Settings provider to be ready"
  local max_attempts=30
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    if adb shell settings get global device_provisioned >/dev/null 2>&1; then
      echo "==> Android Settings provider is ready"
      return 0
    fi

    local attempt_msg="(attempt $attempt/$max_attempts)"
    if [ $((attempt % 5)) -eq 0 ]; then
      echo "  Settings provider not ready yet $attempt_msg, retrying..."
    fi

    sleep 1
    attempt=$((attempt + 1))
  done

  echo "Settings provider did not become ready within timeout ($max_attempts attempts)" >&2
  return 1
}

is_transient_install_error() {
  local error_msg="$1"

  # Check for known transient errors that should trigger retry
  if echo "$error_msg" | grep -qiE "(can't find service|Cannot access system provider|device offline|device not found|Broken pipe|Package Manager not ready)"; then
    return 0  # transient error
  fi

  return 1  # not transient
}

install_apk_with_retry() {
  echo "==> Installing APK $E2E_ANDROID_APP_ID"
  local max_attempts=3
  local attempt=1
  local last_error=""

  while [ $attempt -le $max_attempts ]; do
    last_error="$(adb install -r e2e-apk/app-debug.apk 2>&1)" || true

    if [ $? -eq 0 ]; then
      echo "✅ APK installation succeeded"
      return 0
    fi

    echo "❌ APK installation attempt $attempt failed" >&2

    if is_transient_install_error "$last_error"; then
      echo "   Error is transient: $last_error" >&2
      if [ $attempt -lt $max_attempts ]; then
        echo "   Retrying in 3s..." >&2
        sleep 3

        echo "   Waiting for Android system to stabilize before retry..." >&2
        if ! wait_for_package_manager_ready; then
          echo "   Package Manager not ready on retry attempt $attempt" >&2
        fi
        if ! wait_for_activity_manager_ready; then
          echo "   Activity Manager not ready on retry attempt $attempt" >&2
        fi
        if ! wait_for_settings_provider_ready; then
          echo "   Settings provider not ready on retry attempt $attempt" >&2
        fi
      fi
    else
      echo "   Error appears non-transient: $last_error" >&2
      echo "   Aborting (not retrying permanent failures like APK parsing, signature, etc)" >&2
      echo "APK installation failed with non-transient error" >&2
      return 1
    fi

    attempt=$((attempt + 1))
  done

  echo "APK installation failed after $max_attempts attempts" >&2
  echo "Last error: $last_error" >&2
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

diagnose_app_state_before_flows() {
  echo "==> Diagnosing app state before launching flows"
  echo "==> Launching app briefly to check initial screen"
  adb shell am start -n "com.fesperiquette.keepeat/.MainActivity" 2>&1 || true
  sleep 3

  echo "==> Dumping app window hierarchy"
  local dump_path="/sdcard/window_dump.xml"
  local dump_success="false"

  # Dump UI hierarchy to reliable sdcard path
  if adb shell uiautomator dump "$dump_path" 2>&1 | grep -q "Dump hierarchy saved"; then
    # Verify file exists on device
    if adb shell test -f "$dump_path" 2>/dev/null; then
      echo "==> UI hierarchy dumped to $dump_path"

      # Pull to local maestro-results for inspection
      if adb pull "$dump_path" maestro-results/preflight-ui.xml >/dev/null 2>&1; then
        echo "==> UI hierarchy pulled to maestro-results/preflight-ui.xml"
        dump_success="true"
      else
        echo "⚠️  UI hierarchy pull failed (device → host)"
      fi
    else
      echo "⚠️  UI hierarchy file does not exist on device ($dump_path)"
    fi
  else
    echo "⚠️  UI hierarchy dump failed or returned unexpected output"
  fi

  # Only assert about UI elements if dump succeeded
  if [ "$dump_success" = "true" ]; then
    echo "==> Checking for login-email-input visibility"
    if grep -i "login.*email" maestro-results/preflight-ui.xml >/dev/null 2>&1; then
      echo "   ✓ login-email-input found in UI hierarchy"
    else
      echo "   ℹ  login-email-input NOT found in current UI hierarchy (app may not be on login screen)"
    fi
  else
    echo "⚠️  Skipping UI element checks: dump could not be retrieved"
  fi

  echo "==> Stopping app for clean flow execution"
  adb shell am force-stop "com.fesperiquette.keepeat" || true
  sleep 1
}

ensure_emulator_ready
wait_for_boot_completed
wait_for_package_manager_ready
wait_for_settings_provider_ready
echo "==> Android system providers are ready"
echo "==> Waiting briefly for Android services to stabilize"
sleep 3
forward_backend_to_emulator
install_apk_with_retry
ensure_apk_installed
sleep 8

mkdir -p maestro-results

diagnose_app_state_before_flows

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
  # Critical: Clear app data to reset secure store (tokens, user state)
  # When backend is reset/seeded between flows, app must not retain stale tokens
  adb shell pm clear "$E2E_ANDROID_APP_ID" || true
  # Ensure app is fully stopped after pm clear (pm clear may auto-restart app)
  adb shell am force-stop "$E2E_ANDROID_APP_ID" || true

  # Warmup boot: Launch app to initialize React Native completely
  # This prevents app from starting in an intermediate "semi-dead" state in Maestro
  adb shell am start -n "com.fesperiquette.keepeat/.MainActivity" || true
  sleep 5

  # Cold kill: Force-stop after warmup so Maestro relaunches with clean initialization
  adb shell am force-stop "$E2E_ANDROID_APP_ID" || true
  sleep 3
}

declare -a FLOW_RESULTS
FLOW_RESULTS_PASSED=0
FLOW_RESULTS_FAILED=0

for flow_file in "${FLOW_FILES[@]}"; do
  stabilize_between_flows

  flow_name="$(basename "$flow_file" .yaml)"
  mode="seeded"
  if [ "$flow_name" = "03-stock-empty-state" ]; then
    mode="empty"
  fi

  echo "==> Running flow: $flow_name (mode=$mode)"
  echo "==> Preparing state for $flow_name (mode=$mode)"
  echo "MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT}"
  node scripts/e2e-reset-seed.mjs --mode "$mode" --base-url "$E2E_RESET_SEED_BASE_URL"
  export MAESTRO_DRIVER_STARTUP_TIMEOUT

  echo "==> Emulator state before Maestro flow:"
  adb shell getprop sys.boot_completed || echo "  (boot_completed unavailable)"
  echo "==> App package status:"
  adb shell pm list packages "$E2E_ANDROID_APP_ID" | tr -d '\r' || echo "  (package list failed)"

  if ~/.maestro/bin/maestro test "$flow_file" --format junit --output "maestro-results/$flow_name"; then
    echo "✅ Maestro flow passed: $flow_name"
    FLOW_RESULTS+=("PASSED|$flow_name")
    FLOW_RESULTS_PASSED=$((FLOW_RESULTS_PASSED + 1))
  else
    echo "❌ Maestro flow failed: $flow_name"
    FLOW_RESULTS+=("FAILED|$flow_name")
    FLOW_RESULTS_FAILED=$((FLOW_RESULTS_FAILED + 1))
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
  fi
done

adb logcat -d > emulator-logcat.txt || true

echo ""
echo "=========================================="
echo "Maestro E2E Suite Summary (suite=$MAESTRO_SUITE)"
echo "=========================================="
for result in "${FLOW_RESULTS[@]}"; do
  IFS="|" read -r status flow_name <<< "$result"
  if [ "$status" = "PASSED" ]; then
    echo "✅ $flow_name: PASSED"
  else
    echo "❌ $flow_name: FAILED"
  fi
done
echo "=========================================="
echo "Total: $FLOW_RESULTS_PASSED passed, $FLOW_RESULTS_FAILED failed"
echo "=========================================="

if [ $FLOW_RESULTS_FAILED -gt 0 ]; then
  echo ""
  echo "❌ Maestro suite failed: $FLOW_RESULTS_FAILED flow(s) failed"
  exit 1
else
  echo ""
  echo "✅ Maestro suite passed: all flows succeeded"
  exit 0
fi
