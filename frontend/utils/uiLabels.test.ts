import assert from 'node:assert/strict';
import test from 'node:test';

import { storageZoneLabel } from './uiLabels';

test('storageZoneLabel retourne Frigo pour frigo', () => {
  assert.equal(storageZoneLabel('frigo'), 'Frigo');
});

test('storageZoneLabel retourne Placard pour placard', () => {
  assert.equal(storageZoneLabel('placard'), 'Placard');
});

test('storageZoneLabel retourne Congélateur pour congelateur', () => {
  assert.equal(storageZoneLabel('congelateur'), 'Congélateur');
});

test('storageZoneLabel retourne Zone inconnue pour une zone absente', () => {
  assert.equal(storageZoneLabel(undefined), 'Zone inconnue');
});

test('storageZoneLabel retourne Zone inconnue pour une zone invalide', () => {
  assert.equal(storageZoneLabel('cave'), 'Zone inconnue');
});

// Régression BUG-028 : avant la correction, congelateur retombait sur "Placard"
test('régression BUG-028 : congelateur ne retourne plus Placard', () => {
  assert.notEqual(storageZoneLabel('congelateur'), 'Placard');
});
