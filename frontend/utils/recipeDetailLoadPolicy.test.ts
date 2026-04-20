import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRecipeDetailLoadPolicy } from './recipeDetailLoadPolicy';

test('ouverture recette avec cache hydraté: lecture locale immédiate, aucun fetch backend', () => {
  const decision = resolveRecipeDetailLoadPolicy({
    hasRecipeInCache: true,
    hasInFlightRequest: false,
  });

  assert.equal(decision.useCacheFirst, true);
  assert.equal(decision.shouldFetchFromBackend, false);
  assert.equal(decision.shouldAwaitInFlight, false);
});

test('ouvertures répétées pendant une requête déjà en cours: pas d avalanche de refresh', () => {
  const decision = resolveRecipeDetailLoadPolicy({
    hasRecipeInCache: false,
    hasInFlightRequest: true,
  });

  assert.equal(decision.useCacheFirst, false);
  assert.equal(decision.shouldFetchFromBackend, false);
  assert.equal(decision.shouldAwaitInFlight, true);
});

test('cache absent et aucune requête en cours: un fetch backend unique est autorisé', () => {
  const decision = resolveRecipeDetailLoadPolicy({
    hasRecipeInCache: false,
    hasInFlightRequest: false,
  });

  assert.equal(decision.useCacheFirst, false);
  assert.equal(decision.shouldFetchFromBackend, true);
  assert.equal(decision.shouldAwaitInFlight, false);
});
