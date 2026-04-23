import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTargetIngredientNames, scopeAndDedupeRecipes } from '../utils/recipesScoping';
import { splitRecipeDisplay } from '../utils/recipeListSplit';

test('intégration recettes: fallback exclu + déduplication + partition header/list cohérente', () => {
  const targetIngredients = buildTargetIngredientNames([{ name: 'Tomate' }, { name: 'Oignon' }]);
  const backendRecipes = [
    { id: '1', title: 'Salade tomate', available_ingredients: ['Tomate'] },
    { id: '1', title: 'Salade tomate bis', available_ingredients: ['Tomate'] },
    { id: '2', title: 'Soupe oignon', available_ingredients: ['Oignon'] },
    { id: '3', title: 'Fallback', available_ingredients: ['Tomate'], is_fallback: true },
  ];

  const scoped = scopeAndDedupeRecipes(backendRecipes, targetIngredients);
  const { header, list } = splitRecipeDisplay(scoped, 1);

  assert.deepEqual(
    scoped.map((recipe) => recipe.id),
    ['1', '2'],
  );
  assert.equal(header.length, 1);
  assert.equal(list.length, 1);
  assert.deepEqual([...header, ...list], scoped);
});
