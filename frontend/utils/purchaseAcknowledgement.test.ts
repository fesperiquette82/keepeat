import test from 'node:test';
import assert from 'node:assert/strict';

import { processPurchaseUpdate } from './purchaseAcknowledgement';

type Purchase = { purchaseToken: string };
const purchase: Purchase = { purchaseToken: 'tok_1' };

test('un achat activé avec succès est acquitté auprès du store', async () => {
  const finished: Purchase[] = [];
  const errors: unknown[] = [];

  const outcome = await processPurchaseUpdate(purchase, {
    activate: async () => 'ok',
    finish: async (p) => {
      finished.push(p);
      return undefined;
    },
    onError: (err) => errors.push(err),
  });

  assert.equal(outcome, 'acknowledged');
  assert.deepEqual(finished, [purchase]);
  assert.deepEqual(errors, []);
});

test("[REGRESSION] BUG-062 — une activation échouée n'acquitte PAS la transaction", async () => {
  // Avant le correctif, finishTransaction était appelé dans un `finally` :
  // l'achat était marqué consommé côté Google alors qu'aucun droit n'avait été
  // accordé, rendant la reprise impossible.
  const finished: Purchase[] = [];
  const errors: unknown[] = [];
  const boom = new Error('activation serveur indisponible');

  const outcome = await processPurchaseUpdate(purchase, {
    activate: async () => {
      throw boom;
    },
    finish: async (p) => {
      finished.push(p);
      return undefined;
    },
    onError: (err) => errors.push(err),
  });

  assert.equal(outcome, 'left-pending');
  assert.deepEqual(finished, [], 'la transaction doit rester non confirmée');
  assert.deepEqual(errors, [boom], "l'écran doit être informé de l'échec");
});

test("l'échec d'activation est journalisé pour diagnostic", async () => {
  const logged: { message: string; error: unknown }[] = [];
  const boom = new Error('503');

  await processPurchaseUpdate(purchase, {
    activate: async () => {
      throw boom;
    },
    finish: async () => undefined,
    onError: () => {},
    logWarn: (message, error) => logged.push({ message, error }),
  });

  assert.equal(logged.length, 1);
  assert.equal(logged[0].error, boom);
});

test('un achat acquitté ne remonte aucune erreur même si finish est lent', async () => {
  let finishedAfterActivation = false;
  let activated = false;

  await processPurchaseUpdate(purchase, {
    activate: async () => {
      activated = true;
      return 'ok';
    },
    finish: async () => {
      finishedAfterActivation = activated;
      return undefined;
    },
    onError: () => assert.fail('aucune erreur attendue'),
  });

  assert.equal(finishedAfterActivation, true, "l'acquittement suit l'activation, jamais l'inverse");
});
