import assert from 'node:assert/strict';
import test from 'node:test';

import { mapRecipesFilterToApi } from './recipesFilter';

test('mapRecipesFilterToApi utilise les alias attendus par le backend', () => {
  assert.equal(mapRecipesFilterToApi('expiryDay'), 'expiryDay');
  assert.equal(mapRecipesFilterToApi('expiryWeek'), 'expiryWeek');
  assert.equal(mapRecipesFilterToApi('expiryMonth'), 'expiryMonth');
  assert.equal(mapRecipesFilterToApi('stock'), 'stock');
});

test('BUG-016 : filtre stock envoie stock et non all (cohérence recipesFilter + recipesStore)', () => {
  // recipesFilter.ts et recipesStore.ts FILTER_TO_API doivent envoyer la même valeur pour stock
  assert.equal(mapRecipesFilterToApi('stock'), 'stock');
});
