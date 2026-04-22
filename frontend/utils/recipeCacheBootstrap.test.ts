import assert from 'node:assert/strict';
import test from 'node:test';

import { countCachedRecipes, shouldBootstrapRecipeAssociationsCache } from './recipeCacheBootstrap';

test('détecte un démarrage froid quand aucun lot de recettes n\'est en cache', () => {
  const suggestionsByFilter = {
    stock: [],
    expiryDay: [],
    expiryWeek: [],
    expiryMonth: [],
  };

  assert.equal(countCachedRecipes(suggestionsByFilter), 0);
  assert.equal(shouldBootstrapRecipeAssociationsCache(suggestionsByFilter), true);
});

test('n\'active pas le bootstrap si au moins un lot de recettes est déjà en cache', () => {
  const suggestionsByFilter = {
    stock: [{ id: 'r1' }],
    expiryDay: [],
    expiryWeek: [{ id: 'r2' }],
    expiryMonth: [],
  };

  assert.equal(countCachedRecipes(suggestionsByFilter), 2);
  assert.equal(shouldBootstrapRecipeAssociationsCache(suggestionsByFilter), false);
});
