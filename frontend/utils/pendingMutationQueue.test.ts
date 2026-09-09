import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMutationFailure,
  describeFailure,
  markAttempted,
  mutationsSendableBy,
  remapTempId,
  removeMutation,
  syncStateForItem,
  toFailedMutation,
  type FailedMutation,
  type PendingMutation,
} from './pendingMutationQueue';

const httpError = (status: number) => ({ response: { status } });
const networkError = { message: 'Network Error', code: 'ERR_NETWORK' };

function mutation(overrides: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id: 'm1',
    type: 'ADD',
    payload: {},
    timestamp: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Classification des échecs
// ---------------------------------------------------------------------------

test('[REGRESSION] BUG-065 — un HTTP 503 conserve la mutation au lieu de la supprimer', () => {
  // Scénario reproduit par la revue : « Réponse HTTP 503 pendant la
  // synchronisation d'un ajout → l'action est supprimée de la file ».
  assert.equal(classifyMutationFailure(httpError(503)), 'retry-later');
});

test('[REGRESSION] BUG-065 — un HTTP 500 conserve la mutation', () => {
  assert.equal(classifyMutationFailure(httpError(500)), 'retry-later');
});

test('[REGRESSION] BUG-064 — un 401 (session pas encore chargée) ne perd pas l’action', () => {
  // Scénario reproduit : « Synchronisation avec session pas encore chargée →
  // la requête part sans authentification et l'erreur 401 fait perdre
  // l'action en attente ».
  assert.equal(classifyMutationFailure(httpError(401)), 'wait-for-auth');
  assert.equal(classifyMutationFailure(httpError(403)), 'wait-for-auth');
});

test('une erreur réseau conserve la mutation', () => {
  assert.equal(classifyMutationFailure(networkError), 'retry-later');
});

test('429 et 408 sont réessayables', () => {
  assert.equal(classifyMutationFailure(httpError(429)), 'retry-later');
  assert.equal(classifyMutationFailure(httpError(408)), 'retry-later');
});

test('seuls les refus définitifs sortent de la file', () => {
  for (const status of [400, 404, 409, 410, 422]) {
    assert.equal(classifyMutationFailure(httpError(status)), 'give-up', `status ${status}`);
  }
});

test('un statut inattendu est conservé plutôt que perdu', () => {
  assert.equal(classifyMutationFailure(httpError(418)), 'retry-later');
});

test('describeFailure distingue réseau, session et serveur', () => {
  assert.match(describeFailure(networkError), /Réseau/i);
  assert.match(describeFailure(httpError(401)), /Session/i);
  assert.match(describeFailure(httpError(503)), /Serveur/i);
  assert.match(describeFailure(httpError(404)), /Refusé/i);
});

// ---------------------------------------------------------------------------
// Remplacement des identifiants temporaires
// ---------------------------------------------------------------------------

test('[REGRESSION] BUG-065 — le tempId est remplacé dans les actions suivantes', () => {
  // Scénario reproduit : « Ajout "Lait", puis renommage "Lait corrigé", hors
  // ligne → le renommage part avec l'identifiant temporaire ; l'erreur retire
  // l'action de la file. Le serveur garde "Lait" ».
  const queue: PendingMutation[] = [
    mutation({ id: 'add', type: 'ADD', tempId: 'temp_1', payload: { name: 'Lait' } }),
    mutation({ id: 'upd', type: 'UPDATE', payload: { itemId: 'temp_1', updates: { name: 'Lait corrigé' } } }),
    mutation({ id: 'thr', type: 'THROW', payload: { itemId: 'temp_1' } }),
  ];

  const remapped = remapTempId(queue, 'temp_1', 'real_42');

  assert.equal(remapped[1].payload.itemId, 'real_42');
  assert.equal(remapped[2].payload.itemId, 'real_42');
  assert.deepEqual(remapped[1].payload.updates, { name: 'Lait corrigé' });
});

test('remapTempId laisse intactes les mutations visant un autre article', () => {
  const queue = [mutation({ id: 'a', payload: { itemId: 'autre' } })];
  assert.equal(remapTempId(queue, 'temp_1', 'real_1')[0].payload.itemId, 'autre');
});

test('remapTempId est sans effet si les identifiants sont vides ou identiques', () => {
  const queue = [mutation({ payload: { itemId: 'temp_1' } })];
  assert.equal(remapTempId(queue, '', 'x'), queue);
  assert.equal(remapTempId(queue, 'temp_1', 'temp_1'), queue);
});

// ---------------------------------------------------------------------------
// Retrait ciblé (et non écrasement de la file)
// ---------------------------------------------------------------------------

test('[REGRESSION] BUG-065 — une action ajoutée pendant la synchronisation survit', () => {
  // Scénario reproduit : « Nouvelle action ajoutée pendant une synchronisation
  // déjà en cours → la file passe de deux actions à zéro alors qu'un seul POST
  // a été envoyé ». removeMutation ne retire QUE l'action confirmée, sur la
  // file courante, sans réécrire un instantané périmé.
  const queueAtStart = [mutation({ id: 'm1' }), mutation({ id: 'm2' })];
  const queueNow = [...queueAtStart, mutation({ id: 'm3-ajoutée-pendant-le-flush' })];

  const after = removeMutation(queueNow, 'm1');

  assert.deepEqual(after.map((m) => m.id), ['m2', 'm3-ajoutée-pendant-le-flush']);
});

test('markAttempted incrémente le compteur sans retirer la mutation', () => {
  const queue = [mutation({ id: 'm1' }), mutation({ id: 'm2', attempts: 2 })];
  const after = markAttempted(queue, 'm2');
  assert.equal(after.length, 2);
  assert.equal(after[1].attempts, 3);
  assert.equal(after[0].attempts, undefined);
});

// ---------------------------------------------------------------------------
// Isolation par compte
// ---------------------------------------------------------------------------

test('[REGRESSION] BUG-064 — une action préparée par A ne part pas sur le compte B', () => {
  const queue = [
    mutation({ id: 'a', ownerId: 'userA' }),
    mutation({ id: 'b', ownerId: 'userB' }),
    mutation({ id: 'legacy', ownerId: null }),
  ];

  const sendable = mutationsSendableBy(queue, 'userB');

  assert.deepEqual(sendable.map((m) => m.id), ['b', 'legacy']);
});

test('aucune action n’est envoyable sans utilisateur connecté', () => {
  const queue = [mutation({ ownerId: 'userA' })];
  assert.deepEqual(mutationsSendableBy(queue, null), []);
});

// ---------------------------------------------------------------------------
// Visibilité d'une action refusée
// ---------------------------------------------------------------------------

test('[REGRESSION] BUG-065 — une action refusée devient visible au lieu de disparaître', () => {
  const failed = toFailedMutation(mutation({ id: 'm1' }), httpError(404), 1234);
  assert.equal(failed.status, 404);
  assert.equal(failed.failedAt, 1234);
  assert.match(failed.reason, /Refusé/i);
});

test('syncStateForItem reflète en attente / à corriger / synchronisé', () => {
  const pending: PendingMutation[] = [mutation({ id: 'p', payload: { itemId: 'item-en-attente' } })];
  const failed: FailedMutation[] = [
    { ...mutation({ id: 'f', payload: { itemId: 'item-refusé' } }), failedAt: 1, reason: 'x', status: 404 },
  ];

  assert.equal(syncStateForItem('item-en-attente', pending, failed), 'pending');
  assert.equal(syncStateForItem('item-refusé', pending, failed), 'failed');
  assert.equal(syncStateForItem('item-ok', pending, failed), 'synced');
});

test('un article encore identifié par son tempId est vu comme en attente', () => {
  const pending = [mutation({ id: 'add', type: 'ADD', tempId: 'temp_9', payload: {} })];
  assert.equal(syncStateForItem('temp_9', pending, []), 'pending');
});

test('[REGRESSION] le remappage doit être relu depuis la file, pas depuis un instantané de boucle', () => {
  // Piège trouvé en relecture : `remapTempId` produit de NOUVEAUX objets dans la
  // file du store. Une boucle d'envoi qui aurait capturé les objets d'origine
  // (au lieu de relire la file à chaque tour) enverrait encore l'ancien
  // `temp_…` — le correctif serait inopérant bout en bout tout en passant les
  // tests unitaires de `remapTempId` pris isolément.
  const initial: PendingMutation[] = [
    mutation({ id: 'add', type: 'ADD', tempId: 'temp_1' }),
    mutation({ id: 'upd', type: 'UPDATE', payload: { itemId: 'temp_1', updates: { name: 'X' } } }),
  ];
  const capturedByLoop = [...initial]; // ce qu'une boucle naïve garderait

  const afterAdd = removeMutation(remapTempId(initial, 'temp_1', 'real_42'), 'add');

  // L'objet capturé par la boucle est resté sur l'ancien identifiant…
  assert.equal(capturedByLoop[1].payload.itemId, 'temp_1');
  // …alors que la file, elle, porte bien le nouveau : c'est elle qui fait foi.
  const fromQueue = afterAdd.find((m) => m.id === 'upd');
  assert.equal(fromQueue?.payload.itemId, 'real_42');
});
