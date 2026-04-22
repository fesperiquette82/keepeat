import assert from 'node:assert/strict';
import test from 'node:test';

import { STOCK_FETCH_TTL_MS, shouldSkipStockFetch } from './stockFetchPolicy';

test('écran Stock avec store hydraté et cache frais: skip refetch backend', () => {
  const now = 1_000_000;
  const skipped = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: now - 5_000,
    now,
  });

  assert.equal(skipped, true);
});

test('navigation répétée Stock -> Détail -> Stock dans la fenêtre TTL: pas de refetch avalanche', () => {
  const firstFetchAt = 2_000_000;
  const firstBackToStock = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: firstFetchAt,
    now: firstFetchAt + 2_000,
  });
  const secondOpenDetail = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: firstFetchAt,
    now: firstFetchAt + 8_000,
  });
  const thirdBackToStock = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: firstFetchAt,
    now: firstFetchAt + 12_000,
  });

  assert.equal(firstBackToStock, true);
  assert.equal(secondOpenDetail, true);
  assert.equal(thirdBackToStock, true);
});

test('cache expiré: refetch backend redevient autorisé', () => {
  const now = 3_000_000;
  const skipped = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: now - (STOCK_FETCH_TTL_MS + 1),
    now,
  });

  assert.equal(skipped, false);
});

test('force=true bypass le cache même avec store hydraté', () => {
  const now = 4_000_000;
  const skipped = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: now - 1_000,
    now,
    force: true,
  });

  assert.equal(skipped, false);
});

// Régression : suppression silencieuse des items ajoutés via scan ticket OCR
//
// Scénario : l'utilisateur scanne un ticket (items sans barcode). addItem() appelle
// fetchStock() juste après l'insertion. Si ce fetchStock() n'utilise PAS force:true,
// shouldSkipStockFetch() retourne true (cache encore frais) → les items OCR ne sont
// jamais chargés dans state.items → removeStockItems() les marque notFound et ne tente
// aucun appel HTTP → la suppression échoue silencieusement.
//
// Fix : addItem() appelle désormais fetchStock({ force: true }) pour garantir que les
// items OCR sont dans le store avant que l'utilisateur puisse les supprimer.
test('régression: ajout OCR (sans barcode) — force:true contourne le cache frais pour rendre l\'item supprimable', () => {
  const now = 5_000_000;
  const recentFetch = now - 2_000; // cache frais (2 s), dans le TTL de 30 s

  // Sans force: le fetch est sauté → items OCR absents du store → suppression impossible
  const skippedSansForce = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: recentFetch,
    now,
  });

  // Avec force (comportement de addItem après le fix): fetch forcé → items présents → suppression OK
  const skippedAvecForce = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: recentFetch,
    now,
    force: true,
  });

  assert.equal(skippedSansForce, true,  'sans force: le cache bloque le fetch → items OCR absents');
  assert.equal(skippedAvecForce, false, 'avec force: le cache est bypassé → items OCR chargés');
});
