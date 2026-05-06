#!/usr/bin/env bash
set -euo pipefail

# Capture logcat in background for debugging
# Usage: start-logcat-capture <output-dir>

OUTPUT_DIR="${1:-.}"
LOGCAT_FILE="$OUTPUT_DIR/logcat-full.txt"
LOGCAT_PID_FILE="$OUTPUT_DIR/.logcat.pid"

# Start logcat capture if not already running
start_logcat_capture() {
  if [ -f "$LOGCAT_PID_FILE" ]; then
    local old_pid=$(cat "$LOGCAT_PID_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "[logcat] Already capturing (PID: $old_pid)" >&2
      return 0
    fi
  fi

  mkdir -p "$OUTPUT_DIR"

  # Start logcat capture in background
  adb logcat -G 64M  # Set buffer to 64MB
  adb logcat > "$LOGCAT_FILE" 2>&1 &
  local logcat_pid=$!
  echo "$logcat_pid" > "$LOGCAT_PID_FILE"
  echo "[logcat] Started capturing (PID: $logcat_pid, file: $LOGCAT_FILE)" >&2
}

# Extract React Native crashes
extract_rn_crashes() {
  if [ ! -f "$LOGCAT_FILE" ]; then
    return
  fi

  local crashes_file="$OUTPUT_DIR/rn-crashes.txt"
  grep -i "fatal\|crash\|exception\|error.*at\|androidruntime" "$LOGCAT_FILE" > "$crashes_file" 2>/dev/null || true

  if [ -s "$crashes_file" ]; then
    echo "[logcat] Found $(wc -l < "$crashes_file") crash-related lines → $crashes_file" >&2
  fi
}

# Stop logcat capture
stop_logcat_capture() {
  if [ ! -f "$LOGCAT_PID_FILE" ]; then
    echo "[logcat] No capture PID file found" >&2
    return
  fi

  local logcat_pid=$(cat "$LOGCAT_PID_FILE")

  if kill -0 "$logcat_pid" 2>/dev/null; then
    kill "$logcat_pid" 2>/dev/null || true
    sleep 1
    echo "[logcat] Stopped (PID: $logcat_pid)" >&2
  fi

  rm -f "$LOGCAT_PID_FILE"

  # Extract crashes
  extract_rn_crashes

  # Generate summary
  if [ -f "$LOGCAT_FILE" ]; then
    local total_lines=$(wc -l < "$LOGCAT_FILE")
    local error_lines=$(grep -ic "error\|exception\|crash" "$LOGCAT_FILE" 2>/dev/null || echo 0)
    echo "[logcat] Summary: $total_lines total lines, $error_lines error-related lines" >&2
  fi
}

# Main
case "${1:-}" in
  "start")
    start_logcat_capture "${2:-.}"
    ;;
  "stop")
    stop_logcat_capture
    ;;
  *)
    echo "Usage: $0 {start|stop} [output-dir]" >&2
    exit 1
    ;;
esac
