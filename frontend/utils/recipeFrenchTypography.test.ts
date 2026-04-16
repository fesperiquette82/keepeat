import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFrenchRecipeText } from './recipeFrenchTypography';

test('formatFrenchRecipeText restaure les accents usuels et apostrophes de recette', () => {
  assert.equal(formatFrenchRecipeText('Oeufs brouilles au foie de morue'), 'Œufs brouillés au foie de morue');
  assert.equal(formatFrenchRecipeText('huile d olive'), "huile d'olive");
  assert.equal(formatFrenchRecipeText('Fais chauffer une poele a feu doux si souhaite.'), 'Fais chauffer une poêle à feu doux si souhaité.');
});

test('formatFrenchRecipeText conserve la casse sur les remplacements', () => {
  assert.equal(formatFrenchRecipeText('OEUFS BROUILLES'), 'ŒUFS BROUILLÉS');
});
