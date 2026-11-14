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
  echo "[step] Installing backend dependencies (pip install -r requirements-dev.txt)..."
  cd backend
  $PYTHON -m pip install -r requirements-dev.txt --quiet 2>&1 || {
    cd ..
    echo "❌ pip install failed"
    exit 1
  }
  cd ..
else
  echo "[step] Backend dependencies already installed"
fi

# Step 2: Ruff (lint) if configured
# BUG-079 : la configuration ruff vit dans ruff.toml à la racine et couvre
# backend/ ET tests/. ruff est installé par requirements-dev.txt ; s'il manque,
# c'est une erreur d'installation, pas une raison de sauter le lint.
if [ -f "ruff.toml" ]; then
  if command -v ruff &> /dev/null; then
    echo "[step] Running ruff lint (backend + tests)..."
    ruff check backend tests 2>&1 || {
      echo "❌ ruff lint failed"
      exit 1
    }
    echo "✓ ruff lint passed"
  else
    echo "❌ ruff introuvable : pip install -r backend/requirements-dev.txt"
    exit 1
  fi
else
  echo "[skip] ruff: ruff.toml absent"
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
# BUG-079 : configuration dans mypy.ini à la racine, sur backend/ ET tests/.
if [ -f "mypy.ini" ]; then
  if command -v mypy &> /dev/null; then
    echo "[step] Running mypy type check (backend + tests)..."
    mypy backend tests 2>&1 || {
      echo "❌ mypy type check failed"
      exit 1
    }
    echo "✓ mypy type check passed"
  else
    echo "❌ mypy introuvable : pip install -r backend/requirements-dev.txt"
    exit 1
  fi
else
  echo "[skip] mypy: mypy.ini absent"
fi

# Step 5: Tests (skip in --quick mode)
#
# BUG-070 : cette étape ne lançait que `backend/tests/` (depuis le répertoire
# backend), en annonçant une validation « complète ». Les 20+ fichiers du
# répertoire `tests/` à la racine — billing, entitlements, sécurité admin,
# politique de non-régression — n'étaient jamais exécutés. Les deux
# répertoires sont désormais couverts, et l'absence de l'un est signalée.
if [ "$QUICK_MODE" != "--quick" ]; then
  PYTEST_PATHS=""
  [ -d "backend/tests" ] && PYTEST_PATHS="$PYTEST_PATHS backend/tests"
  [ -d "tests" ] && PYTEST_PATHS="$PYTEST_PATHS tests"

  if [ -z "$PYTEST_PATHS" ]; then
    echo "❌ Aucun répertoire de tests trouvé (backend/tests ni tests) — validation NON concluante"
    exit 1
  fi

  echo "[step] Running pytest sur :$PYTEST_PATHS"
  PYTHONPATH="${PYTHONPATH:-}:$(pwd):$(pwd)/backend" $PYTHON -m pytest $PYTEST_PATHS -q || {
    echo "❌ pytest tests failed"
    exit 1
  }
  echo "✓ pytest tests passed ($PYTEST_PATHS)"
else
  echo "[skip] Tests (--quick mode) — la validation n'est PAS complète"
fi

echo "✅ Python + FastAPI validation PASSED"
exit 0
