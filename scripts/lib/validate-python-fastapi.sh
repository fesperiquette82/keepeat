#!/bin/bash

# validate-python-fastapi.sh — Validate Python FastAPI backend

set -e

QUICK_MODE="${1:-}"

# Check if this stack is present
if ([ ! -f "backend/requirements.txt" ] && [ ! -f "backend/pyproject.toml" ]) || \
   ! (grep -q "fastapi" backend/requirements.txt 2>/dev/null || grep -q "fastapi" backend/pyproject.toml 2>/dev/null); then
  echo "[skip] python-fastapi: requirements.txt/pyproject.toml with fastapi not found"
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[validate] Python + FastAPI (Backend)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Detect Python
PYTHON="python3"
if ! command -v python3 &> /dev/null; then
  if command -v python &> /dev/null; then
    PYTHON="python"
  else
    echo "❌ Python not found"
    exit 1
  fi
fi

echo "Using: $PYTHON $($PYTHON --version)"

# Step 1: Install dependencies
if [ ! -d "backend/.venv" ] && [ ! -d "venv" ]; then
  echo "[step] Installing backend dependencies (pip install -r requirements.txt)..."
  cd backend
  $PYTHON -m pip install -r requirements.txt --quiet 2>&1 || {
    cd ..
    echo "❌ pip install failed"
    exit 1
  }
  cd ..
else
  echo "[step] Backend dependencies already installed"
fi

# Step 2: Ruff (lint) if configured
if grep -q "ruff" backend/requirements.txt 2>/dev/null || grep -q "ruff" backend/pyproject.toml 2>/dev/null; then
  if command -v ruff &> /dev/null; then
    echo "[step] Running ruff lint..."
    cd backend
    ruff check . 2>&1 || {
      cd ..
      echo "❌ ruff lint failed"
      exit 1
    }
    cd ..
    echo "✓ ruff lint passed"
  else
    echo "[skip] ruff: not installed"
  fi
else
  echo "[skip] ruff: not in requirements"
fi

# Step 3: Black (format check) if configured
if grep -q "black" backend/requirements.txt 2>/dev/null || grep -q "black" backend/pyproject.toml 2>/dev/null; then
  if command -v black &> /dev/null; then
    echo "[step] Running black format check..."
    cd backend
    black --check . 2>&1 || {
      cd ..
      echo "❌ black format check failed"
      exit 1
    }
    cd ..
    echo "✓ black format check passed"
  else
    echo "[skip] black: not installed"
  fi
else
  echo "[skip] black: not in requirements"
fi

# Step 4: mypy (type check)
if grep -q "mypy" backend/requirements.txt 2>/dev/null || grep -q "mypy" backend/pyproject.toml 2>/dev/null; then
  if command -v mypy &> /dev/null; then
    echo "[step] Running mypy type check..."
    cd backend
    mypy . 2>&1 || {
      cd ..
      echo "❌ mypy type check failed"
      exit 1
    }
    cd ..
    echo "✓ mypy type check passed"
  else
    echo "[skip] mypy: not installed"
  fi
else
  echo "[skip] mypy: not in requirements"
fi

# Step 5: Tests (skip in --quick mode)
if [ "$QUICK_MODE" != "--quick" ]; then
  if [ -d "backend/tests" ] || [ -f "backend/tests.py" ]; then
    echo "[step] Running pytest..."

    # Priority suites for CI speed (if defined)
    if [ -f "backend/tests/test_critical_bug_regressions.py" ] || \
       [ -f "backend/tests/test_recipe_suggestions_contract.py" ]; then
      echo "  → Priority test suites..."
      cd backend
      $PYTHON -m pytest \
        tests/test_critical_bug_regressions.py \
        tests/test_recipe_suggestions_contract.py \
        -v 2>&1 || {
        cd ..
        echo "❌ Priority pytest tests failed"
        exit 1
      }
      cd ..
      echo "  ✓ Priority test suites passed"

      # Then run all tests
      echo "  → All backend tests..."
      cd backend
      $PYTHON -m pytest tests/ -v 2>&1 || {
        cd ..
        echo "❌ Full pytest tests failed"
        exit 1
      }
      cd ..
      echo "  ✓ All backend tests passed"
    else
      # Run all tests
      cd backend
      $PYTHON -m pytest tests/ -v 2>&1 || {
        cd ..
        echo "❌ pytest tests failed"
        exit 1
      }
      cd ..
      echo "✓ pytest tests passed"
    fi
  else
    echo "[skip] Tests: no tests directory found"
  fi
else
  echo "[skip] Tests (--quick mode)"
fi

echo "✅ Python + FastAPI validation PASSED"
exit 0
