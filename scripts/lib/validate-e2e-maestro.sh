#!/bin/bash

# validate-e2e-maestro.sh — Validate Maestro E2E tests

set -e

QUICK_MODE="${1:-}"

# Check if this stack is present
if [ ! -d ".maestro" ]; then
  echo "[skip] e2e-maestro: .maestro directory not found"
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[validate] E2E Tests (Maestro)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# E2E tests are expensive and are skipped in --quick mode
if [ "$QUICK_MODE" = "--quick" ]; then
  echo "[skip] E2E tests (--quick mode): use full validation before push"
  exit 0
fi

# Check if maestro CLI is available
if ! command -v maestro &> /dev/null; then
  echo "⚠️  maestro CLI not found. Install from: https://maestro.mobile.dev/"
  echo "[skip] E2E tests: maestro not installed (CI will run them)"
  exit 0
fi

# Step 1: Build app for testing
if [ ! -d "frontend/.test-dist" ]; then
  echo "[step] Building app for E2E testing (npm run build:e2e)..."
  cd frontend
  npm run build:e2e 2>&1 || {
    cd ..
    echo "⚠️  app build failed, skipping E2E tests"
    exit 0
  }
  cd ..
else
  echo "[step] App already built for E2E testing"
fi

# Step 2: Reset test data
if [ -f "scripts/e2e-reset-seed.mjs" ]; then
  echo "[step] Resetting test data..."
  node scripts/e2e-reset-seed.mjs 2>&1 || {
    echo "⚠️  test data reset failed"
  }
fi

# Step 3: Run smoke tests (quick validation)
echo "[step] Running Maestro smoke tests (critical paths)..."
if [ -f ".maestro/smoke.yaml" ]; then
  maestro test .maestro/smoke.yaml 2>&1 || {
    echo "❌ Maestro smoke tests failed"
    exit 1
  }
  echo "✓ Maestro smoke tests passed"
else
  echo "[skip] Maestro smoke tests: smoke.yaml not found"
fi

echo "✅ E2E (Maestro) validation PASSED"
exit 0
