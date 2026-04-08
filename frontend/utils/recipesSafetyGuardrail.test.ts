import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSuggestionRecipe } from './recipesSafetyGuardrail';

test('normalizeSuggestionRecipe marque fallback via debug.is_fallback', () => {
  const normalized = normalizeSuggestionRecipe(
    {
      id: 'r-1',
      title: 'Soupe de légumes',
      usedIngredients: ['carotte', 'oignon'],
      missedIngredients: [],
      debug: {
        is_fallback: true,
      },
    },
    0,
  );

  assert.equal(normalized.is_fallback, true);
});

test('normalizeSuggestionRecipe garde false sans fallback explicite', () => {
  const normalized = normalizeSuggestionRecipe(
    {
      id: 'r-2',
      title: 'Salade rapide',
      usedIngredients: ['tomate', 'concombre'],
      missedIngredients: [],
      debug: {
        source: 'guarded-scope',
      },
    },
    0,
  );

  assert.equal(normalized.is_fallback, false);
});
