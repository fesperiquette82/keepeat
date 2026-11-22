#!/bin/bash

# read-profile.sh — Parse .ai/project-profile.json and provide utility functions

set -e

PROFILE_FILE=".ai/project-profile.json"

# Check if jq is available, otherwise use Python fallback
if ! command -v jq &> /dev/null; then
  if command -v python3 &> /dev/null; then
    # Use Python to parse JSON
    JSON_TOOL="python3 -c"
  else
    echo "Error: Neither jq nor python3 found. Cannot parse project profile."
    exit 1
  fi
else
  JSON_TOOL="jq"
fi

# read_profile_stacks(): Extract stacks array from project profile
# Returns: Space-separated list of stacks
read_profile_stacks() {
  if [ ! -f "$PROFILE_FILE" ]; then
    # Auto-detect if profile doesn't exist
    autodetect_stacks
    return
  fi

  if [ "$JSON_TOOL" = "jq" ]; then
    jq -r '.stacks[]' "$PROFILE_FILE" 2>/dev/null | tr '\n' ' '
  else
    python3 -c "
import json, sys
try:
  with open('$PROFILE_FILE') as f:
    data = json.load(f)
    print(' '.join(data.get('stacks', [])))
except Exception as e:
  pass
"
  fi
}

# read_profile_key(key): Extract scalar value from profile
# Usage: read_profile_key "projectName"
read_profile_key() {
  local key="$1"
  if [ ! -f "$PROFILE_FILE" ]; then
    return
  fi

  if [ "$JSON_TOOL" = "jq" ]; then
    jq -r ".$key // empty" "$PROFILE_FILE" 2>/dev/null
  else
    python3 -c "
import json, sys
try:
  with open('$PROFILE_FILE') as f:
    data = json.load(f)
    val = data.get('$key')
    if val:
      print(val)
except Exception as e:
  pass
"
  fi
}

# autodetect_stacks(): Detect stacks from files present
# Returns: Space-separated list of detected stacks
autodetect_stacks() {
  local detected=""

  # Check for React Native Expo
  if [ -f "frontend/app.json" ] && grep -q '"expo"' frontend/app.json 2>/dev/null; then
    detected="$detected react-native-expo"
  fi

  # Check for FastAPI
  if ([ -f "backend/requirements.txt" ] || [ -f "backend/pyproject.toml" ]) && \
     (grep -q "fastapi" backend/requirements.txt 2>/dev/null || grep -q "fastapi" backend/pyproject.toml 2>/dev/null); then
    detected="$detected python-fastapi"
  fi

  # Check for Maestro
  if [ -d ".maestro" ]; then
    detected="$detected e2e-maestro"
  fi

  # Check for Next.js
  if [ -f "package.json" ] && grep -q '"next"' package.json 2>/dev/null; then
    detected="$detected nextjs"
  fi

  # Check for Flutter
  if [ -f "pubspec.yaml" ]; then
    detected="$detected flutter"
  fi

  # Check for Node.js TypeScript
  if [ -f "package.json" ] && grep -q '"typescript"' package.json 2>/dev/null; then
    detected="$detected node-ts"
  fi

  echo "$detected" | xargs  # Trim and normalize
}

# Export functions for sourcing
export -f read_profile_stacks
export -f read_profile_key
export -f autodetect_stacks
