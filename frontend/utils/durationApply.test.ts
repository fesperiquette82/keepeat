import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDurationApply } from './durationApply';

test('resolveDurationApply: une durée positive est valide', () => {
  const result = resolveDurationApply('5');
  assert.equal(result.valid, true);
  assert.equal(result.days, 5);
});

// Régression BUG-026 : avant la correction, une durée <= 0 échouait silencieusement
// (aucun feedback utilisateur). Le helper doit désormais signaler l'échec explicitement.
test('régression BUG-026 : une durée à 0 est invalide (pas de faux succès silencieux)', () => {
  const result = resolveDurationApply('0');
  assert.equal(result.valid, false);
  assert.equal(result.days, null);
});

test('régression BUG-026 : une durée négative est invalide', () => {
  const result = resolveDurationApply('-3');
  assert.equal(result.valid, false);
  assert.equal(result.days, null);
});

test('régression BUG-026 : une saisie non numérique est invalide', () => {
  const result = resolveDurationApply('abc');
  assert.equal(result.valid, false);
  assert.equal(result.days, null);
});

test('régression BUG-026 : une saisie vide est invalide', () => {
  const result = resolveDurationApply('');
  assert.equal(result.valid, false);
  assert.equal(result.days, null);
});

// Régression review PR #144 (chatgpt-codex-connector) : parseInt("1.5") / parseInt("7j")
// tronquent au préfixe numérique (1, 7) au lieu de rejeter la saisie invalide.
test('régression review PR#144 : une saisie décimale ("1.5") est invalide, pas tronquée à 1', () => {
  const result = resolveDurationApply('1.5');
  assert.equal(result.valid, false);
  assert.equal(result.days, null);
});

test('régression review PR#144 : une saisie avec suffixe ("7j") est invalide, pas tronquée à 7', () => {
  const result = resolveDurationApply('7j');
  assert.equal(result.valid, false);
  assert.equal(result.days, null);
});

test('une saisie avec espaces autour d\'un entier valide reste acceptée', () => {
  const result = resolveDurationApply('  5  ');
  assert.equal(result.valid, true);
  assert.equal(result.days, 5);
});
