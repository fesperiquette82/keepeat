import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  formatRecipeDuration,
  joinRecipeMeta,
  recipeTypeLabel,
  resolveRecipeDurationMinutes,
  resolveRecipeIngredientCounts,
} from './recipeDisplay';

test("la durée servie par l'API prime, puis préparation + cuisson, puis l'ancien champ", () => {
  assert.equal(resolveRecipeDurationMinutes({ duration_min: 30, prep_time_min: 5, cook_time_min: 6, timeMinutes: 99 }), 30);
  assert.equal(resolveRecipeDurationMinutes({ prep_time_min: 5, cook_time_min: 6, timeMinutes: 99 }), 11);
  assert.equal(resolveRecipeDurationMinutes({ prep_time_min: 20, cook_time_min: null }), 20);
  assert.equal(resolveRecipeDurationMinutes({ timeMinutes: 12 }), 12);
});

test('BUG-101 : une durée absente, nulle ou invalide est inconnue, jamais 0 ni 15', () => {
  for (const recipe of [null, undefined, {}, { duration_min: 0 }, { duration_min: null }, { duration_min: '30' }, { duration_min: Number.NaN }]) {
    assert.equal(resolveRecipeDurationMinutes(recipe), null);
  }
  assert.equal(formatRecipeDuration(null), null);
  assert.equal(formatRecipeDuration(0), null);
  assert.equal(formatRecipeDuration(210), '210 min');
});

test('BUG-101 : les compteurs du serveur priment sur la taille des listes', () => {
  assert.deepEqual(
    resolveRecipeIngredientCounts({ available_count: 1, missing_count: 3, usedIngredients: ['a', 'b'], missedIngredients: [] }),
    { available: 1, missing: 3 },
  );
  assert.deepEqual(resolveRecipeIngredientCounts({ usedIngredients: ['a', 'b'], missedIngredients: ['c'] }), { available: 2, missing: 1 });
  assert.deepEqual(resolveRecipeIngredientCounts({ available_ingredients: ['a'], missing_ingredients: ['b', 'c'] }), { available: 1, missing: 2 });
  assert.deepEqual(resolveRecipeIngredientCounts({}), { available: 0, missing: 0 });
  assert.deepEqual(resolveRecipeIngredientCounts(null), { available: 0, missing: 0 });
});

test('le type de plat servi par le catalogue a un libellé français', () => {
  assert.equal(recipeTypeLabel('lunch'), 'Déjeuner');
  assert.equal(recipeTypeLabel('dinner'), 'Dîner');
  assert.equal(recipeTypeLabel('breakfast'), 'Petit-déjeuner');
  assert.equal(recipeTypeLabel('snack'), 'En-cas');
  assert.equal(recipeTypeLabel('dessert'), 'Dessert');
  assert.equal(recipeTypeLabel('aperitif'), 'Apéritif');
  assert.equal(recipeTypeLabel('plat'), 'Plat');
  assert.equal(recipeTypeLabel('Plat'), 'Plat');
});

test('un libellé libre de recette générée est affiché tel quel, sinon le libellé par défaut', () => {
  assert.equal(recipeTypeLabel('Poêlée'), 'Poêlée');
  assert.equal(recipeTypeLabel('recette simple'), 'Recette simple');
  assert.equal(recipeTypeLabel(undefined), 'Idée simple');
  assert.equal(recipeTypeLabel('   '), 'Idée simple');
  assert.equal(recipeTypeLabel('x'.repeat(31)), 'Idée simple');
});

test("une ligne d'informations ignore ce qui est inconnu", () => {
  assert.equal(joinRecipeMeta(['30 min', 'Déjeuner']), '30 min · Déjeuner');
  assert.equal(joinRecipeMeta([null, 'Déjeuner', false, undefined, '']), 'Déjeuner');
  assert.equal(joinRecipeMeta([null, false]), '');
});

// --- Les écrans passent par ces aides ----------------------------------------

function source(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test("BUG-101 : la fiche recette n'invente plus « 15 min » ni un type fixe", () => {
  const detail = source('app/recipes/[id].tsx');
  assert.doesNotMatch(detail, /return 15;|: 15;/);
  assert.doesNotMatch(detail, /min · Idée simple/);
  assert.match(detail, /formatRecipeDuration\(resolveRecipeDurationMinutes\(baseRecipe\)\)/);
  assert.match(detail, /recipeTypeLabel\(baseRecipe\?\.dish_type\)/);
});

test("BUG-101 : l'accueil et l'onglet Recettes n'affichent plus « 0 min » ni un compteur à zéro par défaut", () => {
  for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/recipes.tsx']) {
    const src = source(file);
    assert.doesNotMatch(src, /duration_min \?\? recipe\.timeMinutes \?\? 0/, file);
    assert.doesNotMatch(src, /missing_count \?\? recipe\.missingCount \?\? 0/, file);
    assert.doesNotMatch(src, /\.timeMinutes\} min/, file);
    assert.match(src, /timeMinutes: resolveRecipeDurationMinutes\(recipe\)/, file);
    assert.match(src, /resolveRecipeIngredientCounts\(recipe\)/, file);
  }
});
