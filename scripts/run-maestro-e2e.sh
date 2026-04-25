#!/usr/bin/env bash
set -euo pipefail

adb install -r e2e-apk/app-debug.apk
mkdir -p maestro-results

while IFS= read -r flow_file; do
  flow_name="$(basename "$flow_file" .yaml)"
  mode="seeded"
  if [ "$flow_name" = "03-stock-empty-state" ]; then
    mode="empty"
  fi

  echo "==> Preparing state for $flow_name (mode=$mode)"
  node scripts/e2e-reset-seed.mjs --mode="$mode" --base-url=http://10.0.2.2:8000
  ~/.maestro/bin/maestro test "$flow_file" --format junit --output "maestro-results/$flow_name"
done < <(find .maestro -maxdepth 1 -name '*.yaml' ! -name 'config.yaml' | sort)

adb logcat -d > emulator-logcat.txt || true
