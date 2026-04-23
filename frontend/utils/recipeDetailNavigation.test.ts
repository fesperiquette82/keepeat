import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRecipeDetailBackAction } from './recipeDetailNavigation';

test('retour recette: utilise back quand un historique existe', () => {
  assert.deepEqual(resolveRecipeDetailBackAction(true), { type: 'back' });
});

test('retour recette: fallback explicite vers /(tabs)/recipes sans historique', () => {
  assert.deepEqual(resolveRecipeDetailBackAction(false), { type: 'replace', href: '/(tabs)/recipes' });
});
