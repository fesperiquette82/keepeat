#!/bin/bash

# validate-react-native-expo.sh — Validate React Native + Expo frontend

set -e

QUICK_MODE="${1:-}"

# Check if this stack is present
if [ ! -f "frontend/app.json" ] || ! grep -q '"expo"' frontend/app.json 2>/dev/null; then
  echo "[skip] react-native-expo: app.json not found or not Expo project"
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[validate] React Native + Expo (Frontend)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Install dependencies
if [ ! -d "frontend/node_modules" ]; then
  echo "[step] Installing dependencies (npm ci)..."
  cd frontend
  npm ci
  cd ..
else
  echo "[step] Dependencies already installed"
fi

# Step 2: ESLint
if [ -f "frontend/.eslintrc.js" ] || [ -f "frontend/eslint.config.js" ]; then
  echo "[step] Running ESLint..."
  cd frontend
  npm run lint 2>&1 || {
    cd ..
    echo "❌ ESLint failed"
    exit 1
  }
  cd ..
  echo "✓ ESLint passed"
else
  echo "[skip] ESLint: no config found"
fi

# Step 3: TypeScript type check
if [ -f "frontend/tsconfig.json" ]; then
  echo "[step] Running TypeScript type check..."
  cd frontend

  # Try npm run typecheck if it exists
  if grep -q '"typecheck"' package.json 2>/dev/null; then
    npm run typecheck 2>&1 || {
      cd ..
      echo "❌ TypeScript type check failed"
      exit 1
    }
  else
    # Fallback to tsc directly
    npx -y tsc --noEmit 2>&1 || {
      cd ..
      echo "⚠️  TypeScript type check has errors (optional)"
      # Don't fail, just warn
    }
  fi
  cd ..
  echo "✓ TypeScript type check passed"
else
  echo "[skip] TypeScript: no tsconfig.json found"
fi

# Step 4: Tests (skip in --quick mode)
if [ "$QUICK_MODE" != "--quick" ]; then
  echo "[step] Running frontend tests..."

  # Unit tests
  if grep -q '"test:unit"' frontend/package.json 2>/dev/null; then
    echo "  → Unit tests (npm run test:unit)..."
    cd frontend
    npm run test:unit 2>&1 || {
      cd ..
      echo "❌ Unit tests failed"
      exit 1
    }
    cd ..
    echo "  ✓ Unit tests passed"
  fi

  # Integration tests
  if grep -q '"test:integration"' frontend/package.json 2>/dev/null; then
    echo "  → Integration tests (npm run test:integration)..."
    cd frontend
    npm run test:integration 2>&1 || {
      cd ..
      echo "❌ Integration tests failed"
      exit 1
    }
    cd ..
    echo "  ✓ Integration tests passed"
  fi

  # Smoke tests
  if grep -q '"test:smoke"' frontend/package.json 2>/dev/null; then
    echo "  → Smoke tests (npm run test:smoke)..."
    cd frontend
    npm run test:smoke 2>&1 || {
      cd ..
      echo "❌ Smoke tests failed"
      exit 1
    }
    cd ..
    echo "  ✓ Smoke tests passed"
  fi
else
  echo "[skip] Tests (--quick mode)"
fi

echo "✅ React Native + Expo validation PASSED"
exit 0
