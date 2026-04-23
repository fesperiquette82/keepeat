import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowScanFab } from './tabNavigationGuard';

test('affiche le bouton scan sur les écrans onglets autorisés', () => {
  assert.equal(shouldShowScanFab('/(tabs)/stock', ['(tabs)', 'stock']), true);
  assert.equal(shouldShowScanFab('/(tabs)', ['(tabs)']), true);
  assert.equal(shouldShowScanFab('/(tabs)', ['(tabs)', 'index']), true);
});

test('masque le bouton scan sur les routes sensibles', () => {
  assert.equal(shouldShowScanFab('/scan', ['scan']), false);
  assert.equal(shouldShowScanFab('/add-product', ['add-product']), false);
  assert.equal(shouldShowScanFab('/settings', ['settings']), false);
});

test('masque le bouton scan sur les transitions vers des écrans non éligibles', () => {
  assert.equal(shouldShowScanFab('/(tabs)/recipes', ['(tabs)', 'recipes']), false);
  assert.equal(shouldShowScanFab('/premium', ['premium']), false);
  assert.equal(shouldShowScanFab('/stock/123', ['stock', '[id]']), false);
});
