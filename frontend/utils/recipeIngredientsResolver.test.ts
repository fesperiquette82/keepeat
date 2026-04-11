import assert from 'node:assert/strict';
import test from 'node:test';

import type { BackendRecipeSuggestion } from '../store/recipesStore';
import { resolveRecipeIngredients } from './recipeIngredientsResolver';

function recipeSuggestion(input: Partial<BackendRecipeSuggestion>): BackendRecipeSuggestion {
  return {
    id: input.id ?? 'recipe-1',
    title: input.title ?? 'Recette',
    ...input,
  };
}

test('préfère ingredients[] structuré quand présent', () => {
  const recipe = recipeSuggestion({
    ingredients: [{ name: 'Œufs', quantity: 2, unit: 'piece' }],
    usedIngredients: ['riz'],
    missedIngredients: ['crème'],
  });

  const resolved = resolveRecipeIngredients(recipe, 4);

  assert.deepEqual(resolved, [{ name: 'Œufs', quantity: 2, unit: 'piece' }]);
});

test('fallback legacy reste fonctionnel sans ingredients[]', () => {
  const recipe = recipeSuggestion({
    ingredients: [],
    usedIngredients: ['Riz'],
    missedIngredients: ['Œufs'],
  });

  const resolved = resolveRecipeIngredients(recipe, 4);

  assert.equal(resolved.length, 2);
  assert.equal(resolved.some((item) => item.name === 'Riz'), true);
  assert.equal(resolved.some((item) => item.name === 'Œufs'), true);
});

test('ignore display_label comme source de vérité et garde quantity/unit structurés', () => {
  const recipe = recipeSuggestion({
    ingredients: [{ name: 'Riz', quantity: 150, unit: 'g', display_label: 'une poignée' }],
  });

  const resolved = resolveRecipeIngredients(recipe, 4);

  assert.deepEqual(resolved, [{ name: 'Riz', quantity: 150, unit: 'g' }]);
});
