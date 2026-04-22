import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRestoredItemsList } from './stockRestoreInsert';

// Régression : race condition lors de la suppression de 2 items consécutifs du stock.
//
// Avant le correctif, restoreItem() appelait fetchStock() (GET /api/stock) après
// le POST /restore. Si l'utilisateur swippe un 2e item (B) pendant que le GET
// répondait, ce GET pouvait renvoyer B encore actif (le POST /consume de B n'était
// pas encore confirmé) → store réécrit avec B présent → stillActive=true
// → failedCount++ → bouton "Annuler" absent.
//
// Correctif : buildRestoredItemsList insère l'item restauré directement dans le
// store, sans appel réseau. B ne peut plus réapparaître par effet de bord.

const makeItem = (id: string) => ({
  id,
  name: `Article ${id}`,
  added_date: '2026-01-01T00:00:00.000Z',
  status: 'active',
});

test('buildRestoredItemsList: item absent → inséré en tête', () => {
  const a = makeItem('a');
  const b = makeItem('b');
  const c = makeItem('c');
  const result = buildRestoredItemsList([b, c], a);
  assert.deepEqual(result, [a, b, c]);
});

test('buildRestoredItemsList: item déjà présent → dédupliqué et ramené en tête', () => {
  const a = makeItem('a');
  const b = makeItem('b');
  const result = buildRestoredItemsList([b, a], a);
  assert.deepEqual(result, [a, b]);
});

test('buildRestoredItemsList: liste vide → résultat = [item restauré]', () => {
  const a = makeItem('a');
  const result = buildRestoredItemsList([], a);
  assert.deepEqual(result, [a]);
});

test('buildRestoredItemsList: les autres items conservent leur ordre', () => {
  const a = makeItem('a');
  const b = makeItem('b');
  const c = makeItem('c');
  const d = makeItem('d');
  const result = buildRestoredItemsList([b, c, d], a);
  assert.deepEqual(result.map(i => i.id), ['a', 'b', 'c', 'd']);
});

// Régression précise : simule l'état du store après que B a été consommé juste avant
// la restauration de A. Sans le correctif, fetchStock() pouvait ramener B (encore actif
// côté serveur à l'instant de la requête), réintroduisant B dans le store.
test('régression: B consommé avant la restauration de A ne réapparaît pas dans le store', () => {
  const a = makeItem('a');
  const c = makeItem('c');
  // État du store : B absent (consommé juste avant), seul C reste
  const storeAfterConsumeB = [c];

  const result = buildRestoredItemsList(storeAfterConsumeB, a);

  assert.deepEqual(result.map(i => i.id), ['a', 'c']);
  assert.equal(result.some(i => i.id === 'b'), false, 'B ne doit pas réapparaître');
});
