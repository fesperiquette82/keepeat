import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecipeIngredients,
  formatIngredientQuantity,
  scaleIngredients,
  type RecipeIngredient,
} from './recipeIngredients';

test('affiche une quantité numérique + unité naturelle pour les pièces (œufs)', () => {
  const ingredient: RecipeIngredient = { name: 'Œufs', quantity: 2, unit: 'piece' };
  assert.equal(formatIngredientQuantity(ingredient, { ingredientName: ingredient.name }), '2 œufs');
});

test('recalcule les quantités selon le nombre de personnes', () => {
  const base: RecipeIngredient[] = [{ name: 'Riz', quantity: 300, unit: 'g' }];

  const forTwo = scaleIngredients(base, 2, 4);
  const forEight = scaleIngredients(base, 8, 4);

  assert.equal(forTwo[0]?.quantity, 150);
  assert.equal(forEight[0]?.quantity, 600);
});

test('formate correctement les unités g/ml/pièce/cuillère', () => {
  assert.equal(formatIngredientQuantity({ quantity: 150, unit: 'g' }), '150 g');
  assert.equal(formatIngredientQuantity({ quantity: 100, unit: 'ml' }), '100 ml');
  assert.equal(formatIngredientQuantity({ quantity: 1, unit: 'piece' }, { ingredientName: 'olive' }), '1 pièce');
  assert.equal(formatIngredientQuantity({ quantity: 1, unit: 'tbsp' }), '1 c. à soupe');
});

test('la normalisation frontend n’utilise plus "portion" comme fallback principal', () => {
  const ingredients = buildRecipeIngredients(['Riz', 'Crème liquide', 'Œufs'], 4);
  const labels = ingredients.map((ingredient) => formatIngredientQuantity(ingredient, { ingredientName: ingredient.name }));

  for (const label of labels) {
    assert.equal(label.includes('portion'), false);
  }
});

test('sans unité ou sans quantité, on garde un fallback lisible', () => {
  assert.equal(formatIngredientQuantity({ quantity: null, unit: null }), 'Quantité à ajuster');
});

test('le pluriel français reste cohérent pour les unités principales', () => {
  assert.equal(formatIngredientQuantity({ quantity: 1, unit: 'box' }), '1 boîte');
  assert.equal(formatIngredientQuantity({ quantity: 2, unit: 'box' }), '2 boîtes');
  assert.equal(formatIngredientQuantity({ quantity: 1, unit: 'pot' }), '1 pot');
  assert.equal(formatIngredientQuantity({ quantity: 3, unit: 'pot' }), '3 pots');
});
