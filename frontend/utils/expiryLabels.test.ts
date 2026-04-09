import assert from 'node:assert/strict';
import test from 'node:test';

import { expiryColor, expiryText } from './expiryLabels';

test('expiryText retourne le libellé attendu pour chaque cas', () => {
  assert.equal(expiryText(null), 'Date non renseignée');
  assert.equal(expiryText(-2), 'Périmé depuis 2 j');
  assert.equal(expiryText(0), "Expire aujourd'hui");
  assert.equal(expiryText(1), 'Expire demain');
  assert.equal(expiryText(5), 'Expire dans 5 j');
});

test('expiryColor retourne la couleur selon le niveau d\'urgence', () => {
  assert.equal(expiryColor(null), '#6B7280');
  assert.equal(expiryColor(-1), '#EF4444');
  assert.equal(expiryColor(0), '#EF4444');
  assert.equal(expiryColor(2), '#F97316');
  assert.equal(expiryColor(6), '#EAB308');
  assert.equal(expiryColor(10), '#166534');
});
