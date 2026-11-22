import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { formatRecipeDuration, joinRecipeMeta, resolveRecipeDurationMinutes, resolveRecipeIngredientCounts } from './recipeDisplay';
import { sanitizeRecipe } from './recipeSanitizer';
import { countLabelFr } from './uiText';

// BUG-101 : l'API sert `duration_min`, `available_count`, `missing_count` et
// `dish_type`. Le nettoyage ne gardait qu'une liste fixe de champs et les
// perdait : « 0 min » dans les listes, « 15 min » inventé sur toutes les
// fiches, « Tout est là » même quand il manquait des ingrédients.

// Forme réelle d'une suggestion servie par /api/recipes/suggestions.
const SERVED_SUGGESTION = {
  id: 'fr_puree_carottes',
  title: 'Puree de carottes',
  summary: 'Une purée douce et simple.',
  instructions_summary: 'Une purée douce et simple.',
  image: '',
  servings: 2,
  dish_type: 'lunch',
  duration_min: 30,
  available_count: 1,
  missing_count: 1,
  available_ingredients: ['carotte'],
  missing_ingredients: ['beurre'],
  score: 0.5,
  steps: ['Cuire les carottes.', 'Mixer.'],
  ingredients: [
    { name: 'carotte', quantity: null, unit: null, optional: false, available: true, matched_stock_item_ids: ['stock-1'] },
    { name: 'beurre', quantity: null, unit: null, optional: false, available: false, matched_stock_item_ids: [] },
  ],
};

test("BUG-101 : la durée, les compteurs et le type servis par l'API survivent au nettoyage", () => {
  const recipe = sanitizeRecipe(SERVED_SUGGESTION, 0);
  assert.equal(recipe.duration_min, 30);
  assert.equal(recipe.available_count, 1);
  assert.equal(recipe.missing_count, 1);
  assert.equal(recipe.dish_type, 'lunch');
  // Le reste du nettoyage est inchangé.
  assert.equal(recipe.id, 'fr_puree_carottes');
  assert.deepEqual(recipe.usedIngredients, ['carotte']);
  assert.deepEqual(recipe.missedIngredients, ['beurre']);
  assert.equal(recipe.ingredients?.length, 2);
});

test("BUG-101 : l'accueil affiche la durée et les ingrédients réels d'une suggestion", () => {
  const recipe = sanitizeRecipe(SERVED_SUGGESTION, 0);
  const counts = resolveRecipeIngredientCounts(recipe);
  const line = joinRecipeMeta([
    formatRecipeDuration(resolveRecipeDurationMinutes(recipe)),
    `${countLabelFr(counts.available, 'ingrédient')} disponible`,
    counts.missing > 0 && `Il manque ${countLabelFr(counts.missing, 'ingrédient')}`,
  ]);
  assert.equal(line, '30 min · 1 ingrédient disponible · Il manque 1 ingrédient');
});

test('une recette décrite par préparation et cuisson donne leur somme', () => {
  const recipe = sanitizeRecipe({ id: 'omelette', title: 'Omelette', prep_time_min: 5, cook_time_min: 6 }, 0);
  assert.equal(recipe.duration_min, 11);
  assert.equal(recipe.prep_time_min, 5);
  assert.equal(recipe.cook_time_min, 6);
});

test("BUG-101 : sans durée connue, aucune durée n'est inventée", () => {
  const recipe = sanitizeRecipe({ id: 'mystere', title: 'Mystère' }, 0);
  assert.equal(recipe.duration_min, undefined);
  assert.equal(formatRecipeDuration(resolveRecipeDurationMinutes(recipe)), null);
});

test('sans compteur servi, les compteurs viennent des listes d’ingrédients', () => {
  const recipe = sanitizeRecipe({ id: 'r', title: 'R', usedIngredients: ['riz', 'oeuf'], missedIngredients: ['lait'] }, 0);
  assert.equal(recipe.available_count, 2);
  assert.equal(recipe.missing_count, 1);
});

test('des valeurs invalides ne passent pas le nettoyage', () => {
  const recipe = sanitizeRecipe(
    { id: 'r', title: 'R', duration_min: -5, available_count: 'deux', missing_count: -1, dish_type: '   ' },
    0,
  );
  assert.equal(recipe.duration_min, undefined);
  assert.equal(recipe.available_count, 0);
  assert.equal(recipe.missing_count, 0);
  assert.equal(recipe.dish_type, undefined);
});

test('BUG-101 : le magasin utilise ce nettoyage, sans copie locale', () => {
  const store = fs.readFileSync(path.join(process.cwd(), 'store/recipesStore.ts'), 'utf8');
  assert.match(store, /import \{ sanitizeRecipe, type BackendRecipeSuggestion \} from '\.\.\/utils\/recipeSanitizer';/);
  assert.doesNotMatch(store, /function sanitizeRecipe\(/);
});
