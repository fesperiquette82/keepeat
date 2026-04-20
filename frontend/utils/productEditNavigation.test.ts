import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductEditRoute,
  PRODUCT_EDIT_ROUTE,
  STOCK_DETAIL_EDIT_ICON,
  STOCK_DETAIL_EDIT_LABEL,
} from './productEditNavigation';

test('le bouton modifier expose un libellé discret et lisible', () => {
  assert.equal(STOCK_DETAIL_EDIT_LABEL, 'Modifier');
  assert.equal(STOCK_DETAIL_EDIT_ICON, 'create-outline');
});

test("la navigation d'édition pointe vers le flux partagé de correction produit", () => {
  const route = buildProductEditRoute('item-42');
  assert.equal(route.pathname, PRODUCT_EDIT_ROUTE);
  assert.deepEqual(route.params, { id: 'item-42' });
});
