import assert from 'node:assert/strict';
import test from 'node:test';

import { countLabelFr, formatEuroFr, pluralizeFr } from './uiText';

test('pluralizeFr gère singulier/pluriel', () => {
  assert.equal(pluralizeFr(1, 'ingrédient'), 'ingrédient');
  assert.equal(pluralizeFr(2, 'ingrédient'), 'ingrédients');
  assert.equal(pluralizeFr(0, 'cheval', 'chevaux'), 'chevaux');
});

test('countLabelFr construit un libellé naturel', () => {
  assert.equal(countLabelFr(1, 'produit'), '1 produit');
  assert.equal(countLabelFr(4, 'produit'), '4 produits');
});

test('formatEuroFr formate en français avec espace avant euro', () => {
  assert.equal(formatEuroFr(12.5), '12,5 €');
  assert.equal(formatEuroFr(1000), '1 000 €');
});
