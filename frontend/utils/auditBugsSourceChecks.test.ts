import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-022 — stockStore.ts : les actions du store doivent utiliser get(), pas
// useStockStore.getState() (auto-référence inutile et incohérente).
// ---------------------------------------------------------------------------

test('régression BUG-022 : markConsumed/markThrown utilisent get() et non useStockStore.getState()', () => {
  const src = readSource('store/stockStore.ts');

  const markConsumedStart = src.indexOf('markConsumed: async');
  const markThrownStart = src.indexOf('markThrown: async');
  assert.ok(markConsumedStart !== -1 && markThrownStart !== -1);

  const markConsumedBody = src.slice(markConsumedStart, markConsumedStart + 700);
  const markThrownBody = src.slice(markThrownStart, markThrownStart + 700);

  assert.doesNotMatch(markConsumedBody, /useStockStore\.getState\(\)/);
  assert.doesNotMatch(markThrownBody, /useStockStore\.getState\(\)/);
  assert.match(markConsumedBody, /const \{ items, priorityItems, stats \} = get\(\);/);
  assert.match(markThrownBody, /const \{ items, priorityItems, stats \} = get\(\);/);
});

// ---------------------------------------------------------------------------
// BUG-024 — recipes.tsx : une seule passe de filtrage par ingrédients cibles
// (via buildScopedRecipesWithDiagnostics), plus de double calcul.
// ---------------------------------------------------------------------------

test('régression BUG-024 : recipes.tsx ne calcule plus le filtre de recettes deux fois', () => {
  const src = readSource('app/(tabs)/recipes.tsx');

  assert.match(src, /buildScopedRecipesWithDiagnostics\(rawRecipes, targetIngredientNames\)/);
  // filterRecipesByTargetIngredients ne doit plus être appelé directement dans l'écran
  // (la logique est encapsulée une seule fois dans buildScopedRecipesWithDiagnostics).
  assert.doesNotMatch(src, /\bfilterRecipesByTargetIngredients\(/);
  assert.doesNotMatch(src, /\bscopeAndDedupeRecipes\(/);
});

// ---------------------------------------------------------------------------
// BUG-027 — add-product.tsx : l'effet lookupProduct doit ignorer sa résolution
// si le composant a été démonté entre-temps (pas de setState post-unmount).
// ---------------------------------------------------------------------------

test('régression BUG-027 : l\'effet lookupProduct a un guard "cancelled" avec cleanup', () => {
  const src = readSource('app/add-product.tsx');

  const effectStart = src.indexOf('if (!normalizedBarcode || normalizedParamName || hasPrefilledFromLookup) return;');
  assert.ok(effectStart !== -1);
  const effectBody = src.slice(effectStart, effectStart + 1400);

  assert.match(effectBody, /let cancelled = false;/);
  assert.match(effectBody, /if \(cancelled\) return;/);
  assert.match(effectBody, /return \(\) => \{\s*cancelled = true;\s*\};/);
});
