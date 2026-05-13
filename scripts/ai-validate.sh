#!/bin/bash

# ai-validate.sh — Unified validation dispatcher for KeepEat (multi-stack)
#
# Usage:
#   ./scripts/ai-validate.sh              # Full validation (lint + typecheck + tests + E2E)
#   ./scripts/ai-validate.sh --quick      # Quick validation (lint + typecheck only, skip tests)
#   ./scripts/ai-validate.sh --stacks <s> # Override stack detection (e.g., --stacks react-native-expo)
#
# Exit codes:
#   0 = All validations passed
#   1 = At least one validation failed

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
QUICK_MODE=""
STACKS=""
SHOW_HELP=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --quick)
      QUICK_MODE="--quick"
      shift
      ;;
    --stacks)
      STACKS="$2"
      shift 2
      ;;
    --help|-h)
      SHOW_HELP=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      SHOW_HELP=true
      shift
      ;;
  esac
done

if [ "$SHOW_HELP" = true ]; then
  cat << 'EOF'
usage: ./scripts/ai-validate.sh [OPTIONS]

  Unified validation dispatcher for KeepEat (React Native Expo + FastAPI + Maestro)

OPTIONS:
  --quick          Skip tests (lint + typecheck only) — faster feedback during dev
  --stacks LIST    Override stack detection (space-separated: react-native-expo python-fastapi e2e-maestro)
  --help, -h       Show this help message

EXAMPLES:
  ./scripts/ai-validate.sh                              # Full validation
  ./scripts/ai-validate.sh --quick                      # Fast validation (no tests)
  ./scripts/ai-validate.sh --stacks react-native-expo  # Frontend only

EXIT CODES:
  0 = All validations passed
  1 = At least one validation failed

EOF
  exit 0
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

# Source utility functions
if [ ! -f "$LIB_DIR/read-profile.sh" ]; then
  echo "❌ Error: scripts/lib/read-profile.sh not found"
  exit 1
fi
source "$LIB_DIR/read-profile.sh"

# Header
echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                    KeepEat Validation Pipeline                             ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Determine stacks to validate
if [ -z "$STACKS" ]; then
  echo "Detecting stacks..."
  STACKS=$(read_profile_stacks)
  if [ -z "$STACKS" ]; then
    echo "❌ No stacks detected. Create .ai/project-profile.json or ensure project files exist."
    exit 1
  fi
fi

echo -e "${BLUE}Stacks to validate:${NC}"
for stack in $STACKS; do
  echo "  • $stack"
done
echo ""

# Determine mode
if [ "$QUICK_MODE" = "--quick" ]; then
  echo -e "${YELLOW}Mode: QUICK (skip tests)${NC}"
else
  echo -e "${GREEN}Mode: FULL (include tests + E2E)${NC}"
fi
echo ""

# Track failures
FAILED_STACKS=""
EXIT_CODE=0

# Validate each stack
for stack in $STACKS; do
  case $stack in
    react-native-expo)
      if [ ! -f "$LIB_DIR/validate-react-native-expo.sh" ]; then
        echo "❌ Error: validate-react-native-expo.sh not found"
        EXIT_CODE=1
      else
        bash "$LIB_DIR/validate-react-native-expo.sh" "$QUICK_MODE" || EXIT_CODE=1
      fi
      ;;
    python-fastapi)
      if [ ! -f "$LIB_DIR/validate-python-fastapi.sh" ]; then
        echo "❌ Error: validate-python-fastapi.sh not found"
        EXIT_CODE=1
      else
        bash "$LIB_DIR/validate-python-fastapi.sh" "$QUICK_MODE" || EXIT_CODE=1
      fi
      ;;
    e2e-maestro)
      if [ ! -f "$LIB_DIR/validate-e2e-maestro.sh" ]; then
        echo "❌ Error: validate-e2e-maestro.sh not found"
        EXIT_CODE=1
      else
        bash "$LIB_DIR/validate-e2e-maestro.sh" "$QUICK_MODE" || EXIT_CODE=1
      fi
      ;;
    *)
      echo "⚠️  Unknown stack: $stack (skipped)"
      ;;
  esac
done

# Step 6: Global policy check (verify-tests-added.mjs)
# This is NOT run in --quick mode since it assumes tests exist
if [ "$QUICK_MODE" != "--quick" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "[validate] Policy Check (Tests Added)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ -f "$SCRIPT_DIR/verify-tests-added.mjs" ]; then
    if command -v node &> /dev/null; then
      echo "[step] Checking that tests are added for code changes..."
      node "$SCRIPT_DIR/verify-tests-added.mjs" HEAD~1 2>&1 || EXIT_CODE=1
      echo "✓ Test policy check passed"
    else
      echo "[skip] verify-tests-added.mjs: node not found"
    fi
  else
    echo "[skip] verify-tests-added.mjs not found"
  fi
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "║                  ${GREEN}✅ ALL VALIDATIONS PASSED${NC}                             ║"
else
  echo -e "║                  ${RED}❌ VALIDATION FAILED${NC}                                  ║"
fi
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

if [ $EXIT_CODE -ne 0 ]; then
  echo -e "${RED}Fix the errors above and run again:${NC}"
  echo "  ./scripts/ai-validate.sh"
  echo ""
fi

exit $EXIT_CODE
