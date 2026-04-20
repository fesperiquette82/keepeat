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
