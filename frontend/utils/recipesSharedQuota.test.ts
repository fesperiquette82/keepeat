import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-048 — le quota "recettes suggérées" (backend/entitlements.py::FEATURE_AI)
// couvre désormais le catalogue local ET le repli IA, plus seulement l'IA.
// Le rafraîchissement en arrière-plan des associations recette/stock (jusqu'à
// 4 appels parallèles par mutation de stock) NE doit PAS consommer ce quota —
// seul l'appel direct depuis l'écran Recettes doit compter. Une régression ici
// viderait le quota gratuit (8/mois) en une ou deux actions de stock.
// ---------------------------------------------------------------------------

const src = readSource('store/recipesStore.ts');

test('fetchSuggestions ajoute count_usage=false uniquement quand countUsage est false', () => {
  assert.match(src, /countUsage\s*\?\s*''\s*:\s*'&count_usage=false'/);
});

test('refreshRecipeAssociationsForStockMutation (rafraîchissement en arrière-plan) passe countUsage=false', () => {
  assert.match(src, /fetchSuggestions\(filter,\s*false\)/);
});

test("ensureRecipeAssociationsFromCache (bootstrap au démarrage) passe countUsage=false", () => {
  assert.match(src, /fetchSuggestions\('stock',\s*false\)/);
});

test('fetchSuggestions déclenche le paywall sur une erreur premium/quota (429/403)', () => {
  assert.match(src, /import \{ extractPremiumErrorDetail \} from '\.\.\/utils\/premiumErrors';/);
  assert.match(src, /import \{ usePremiumUiStore \} from '\.\/premiumUiStore';/);
  assert.match(src, /extractPremiumErrorDetail\(error\)/);
  assert.match(src, /usePremiumUiStore\.getState\(\)\.openPaywall\(premiumError\)/);
});
