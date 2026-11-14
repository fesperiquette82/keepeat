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

# BUG-070 : ce script prétendait valider les tests E2E alors qu'il ne pouvait
# rien exécuter :
#   - il cherchait `.maestro/smoke.yaml`, qui n'existe pas (le scénario de
#     lancement s'appelle `00-smoke-launch.yaml`) et sortait en SUCCÈS ;
#   - il appelait `npm run build:e2e`, script absent de frontend/package.json ;
#   - il considérait `frontend/.test-dist` (sortie de compilation des tests
#     TypeScript) comme la preuve qu'une application était construite.
# Il exécute désormais les scénarios réellement présents et distingue
# explicitement « validé » de « non exécuté ».

# Step 1: Reset test data (optionnel)
if [ -f "scripts/e2e-reset-seed.mjs" ]; then
  echo "[step] Resetting test data..."
  node scripts/e2e-reset-seed.mjs 2>&1 || {
    echo "⚠️  test data reset failed"
  }
fi

# Step 2: Exécuter le scénario de fumée réellement présent
SMOKE_FLOW=""
for candidate in ".maestro/00-smoke-launch.yaml" ".maestro/smoke.yaml"; do
  if [ -f "$candidate" ]; then
    SMOKE_FLOW="$candidate"
    break
  fi
done

if [ -z "$SMOKE_FLOW" ]; then
  echo "❌ Aucun scénario de fumée Maestro trouvé dans .maestro/ — validation E2E NON exécutée"
  echo "   (attendu : 00-smoke-launch.yaml)"
  exit 1
fi

echo "[step] Running Maestro smoke flow ($SMOKE_FLOW)..."
maestro test "$SMOKE_FLOW" 2>&1 || {
  echo "❌ Maestro smoke test failed ($SMOKE_FLOW)"
  exit 1
}
echo "✓ Maestro smoke test passed ($SMOKE_FLOW)"

echo "✅ E2E (Maestro) validation PASSED"
exit 0
