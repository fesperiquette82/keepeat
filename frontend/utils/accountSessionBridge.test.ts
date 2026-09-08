import test from 'node:test';
import assert from 'node:assert/strict';

import {
  notifyAccountChanged,
  onAccountChanged,
  resetAccountChangeListeners,
} from './accountSessionBridge';

test('[REGRESSION] BUG-064 — la déconnexion prévient les stores de données', () => {
  // Avant le correctif, `logout` ne vidait que SecureStore et l'état d'auth :
  // le stock et les actions en attente du compte sortant restaient en mémoire
  // et dans AsyncStorage, donc visibles par le compte suivant.
  resetAccountChangeListeners();
  const seen: (string | null)[] = [];
  onAccountChanged((userId) => seen.push(userId));

  notifyAccountChanged(null);

  assert.deepEqual(seen, [null]);
});

test('le compte entrant est transmis lors d’une connexion', () => {
  resetAccountChangeListeners();
  const seen: (string | null)[] = [];
  onAccountChanged((userId) => seen.push(userId));

  notifyAccountChanged('userB');

  assert.deepEqual(seen, ['userB']);
});

test('un abonné qui échoue n’empêche pas les autres ni la déconnexion', () => {
  resetAccountChangeListeners();
  const seen: string[] = [];
  onAccountChanged(() => {
    throw new Error('store cassé');
  });
  onAccountChanged(() => seen.push('second abonné appelé'));

  assert.doesNotThrow(() => notifyAccountChanged(null));
  assert.deepEqual(seen, ['second abonné appelé']);
});

test('se désabonner arrête les notifications', () => {
  resetAccountChangeListeners();
  const seen: (string | null)[] = [];
  const unsubscribe = onAccountChanged((userId) => seen.push(userId));

  notifyAccountChanged('a');
  unsubscribe();
  notifyAccountChanged('b');

  assert.deepEqual(seen, ['a']);
});
