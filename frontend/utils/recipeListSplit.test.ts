import test from 'node:test';
import assert from 'node:assert/strict';

import { splitRecipeDisplay } from './recipeListSplit';

// Régression : duplication des recettes dans l'écran Recettes.
//
// Avant le correctif, recipes.tsx rendait :
//   ListHeaderComponent : classicSuggestions.slice(0, 2)  ← 2 premières recettes
//   FlatList data       : classicSuggestions              ← TOUTES les recettes
// → les 2 premières recettes apparaissaient deux fois.
//
// Correctif : FlatList data = classicSuggestions.slice(2), soit recipeListSplit.list.
// splitRecipeDisplay garantit l'invariant de partition : header ∪ list = suggestions,
// header ∩ list = ∅.

test('splitRecipeDisplay: les 2 premières recettes vont dans le header (plan card)', () => {
  const suggestions = ['A', 'B', 'C', 'D', 'E'];
  const { header } = splitRecipeDisplay(suggestions);
  assert.deepEqual(header, ['A', 'B']);
});

test('splitRecipeDisplay: le reste des recettes va dans la liste (FlatList data)', () => {
  const suggestions = ['A', 'B', 'C', 'D', 'E'];
  const { list } = splitRecipeDisplay(suggestions);
  assert.deepEqual(list, ['C', 'D', 'E']);
});

test('régression: header et list ne contiennent aucun item en commun (plus de doublons)', () => {
  const suggestions = ['A', 'B', 'C', 'D', 'E'];
  const { header, list } = splitRecipeDisplay(suggestions);

  const headerSet = new Set(header);
  for (const item of list) {
    assert.equal(headerSet.has(item), false, `"${item}" ne doit pas apparaître dans header ET list`);
  }
});

test('régression: header.concat(list) reconstitue le tableau original complet', () => {
  const suggestions = ['A', 'B', 'C', 'D', 'E'];
  const { header, list } = splitRecipeDisplay(suggestions);
  assert.deepEqual([...header, ...list], suggestions);
});

test('splitRecipeDisplay: tableau vide → header et list vides', () => {
  const { header, list } = splitRecipeDisplay([]);
  assert.deepEqual(header, []);
  assert.deepEqual(list, []);
});

test('splitRecipeDisplay: 1 recette → dans header uniquement, list vide', () => {
  const { header, list } = splitRecipeDisplay(['seule']);
  assert.deepEqual(header, ['seule']);
  assert.deepEqual(list, []);
});

test('splitRecipeDisplay: exactement 2 recettes → header plein, list vide', () => {
  const { header, list } = splitRecipeDisplay(['A', 'B']);
  assert.deepEqual(header, ['A', 'B']);
  assert.deepEqual(list, []);
});

test('splitRecipeDisplay: headerCount personnalisé (3) est respecté', () => {
  const suggestions = ['A', 'B', 'C', 'D', 'E'];
  const { header, list } = splitRecipeDisplay(suggestions, 3);
  assert.deepEqual(header, ['A', 'B', 'C']);
  assert.deepEqual(list, ['D', 'E']);
});
