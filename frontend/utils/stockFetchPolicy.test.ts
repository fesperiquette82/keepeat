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
// Historique du bug et des correctifs successifs :
//
// v1 (incorrect) : addItem() appelait fetchStock() sans force:true → le cache frais
//   bloquait le fetch → item OCR absent du store → removeStockItems() le marquait
//   notFound → suppression silencieuse, banner d'erreur sans bouton "Annuler".
//
// v2 (partiellement correct) : addItem() appelait fetchStock({ force: true }).
//   Corrigeait les cas mono-item mais introduisait une race condition pour les ajouts
//   OCR parallèles (scan-receipt.tsx fait Promise.all de plusieurs addItem) :
//   plusieurs GET /api/stock partaient avant que tous les POST soient confirmés →
//   le dernier GET à répondre pouvait renvoyer une liste incomplète → store incomplet
//   → seul le premier item était trouvable pour suppression.
//
// v3 (solution retenue) : addItem() insère directement newItem dans state.items
//   après le POST, sans fetchStock(). Même logique que le chemin offline (tempItem).
//   Plus de race condition possible : chaque addItem() garantit son item dans le store.
//
// Ce test vérifie que le mécanisme force:true fonctionne correctement (utile pour
// d'autres callers comme restoreItem() ou les triggers de navigation).
test('régression: ajout OCR (sans barcode) — force:true contourne le cache frais (garde-fou pour les callers hors addItem)', () => {
  const now = 5_000_000;
  const recentFetch = now - 2_000; // cache frais (2 s), dans le TTL de 30 s

  // Sans force: le fetch est sauté → items OCR absents du store si fetchStock est la seule source
  const skippedSansForce = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: recentFetch,
    now,
  });

  // Avec force: le cache est bypassé → fetch serveur garanti
  const skippedAvecForce = shouldSkipStockFetch({
    hasItemsInStore: true,
    lastFetchAt: recentFetch,
    now,
    force: true,
  });

  assert.equal(skippedSansForce, true,  'sans force: le cache bloque le fetch');
  assert.equal(skippedAvecForce, false, 'avec force: le cache est bypassé');
});
