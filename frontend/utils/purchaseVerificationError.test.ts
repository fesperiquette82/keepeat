import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describePurchaseVerificationError,
  extractPurchaseErrorCode,
} from './purchaseVerificationError';

test('[REGRESSION] BUG-062 — une vérification indisponible est présentée comme réessayable', () => {
  const err = { response: { status: 503, data: { detail: { code: 'VERIFICATION_UNAVAILABLE' } } } };
  const message = describePurchaseVerificationError(err);
  assert.match(message, /pas perdu/i);
  assert.doesNotMatch(message, /contactez le support avec votre reçu/i);
});

test('[REGRESSION] BUG-062 — un achat refusé par Google est distingué d’une panne', () => {
  const err = { response: { status: 402, data: { detail: { code: 'PURCHASE_REJECTED' } } } };
  const message = describePurchaseVerificationError(err);
  assert.match(message, /Google Play/i);
  assert.doesNotMatch(message, /quelques minutes/i);
});

test('un jeton déjà rattaché oriente vers le bon compte, pas vers le support seul', () => {
  const err = { response: { status: 409, data: { detail: { code: 'PURCHASE_TOKEN_ALREADY_LINKED' } } } };
  assert.match(describePurchaseVerificationError(err), /autre compte/i);
});

test('un paiement non reçu est traité comme un refus', () => {
  const err = { response: { status: 402, data: { detail: { code: 'PAYMENT_NOT_RECEIVED' } } } };
  assert.match(describePurchaseVerificationError(err), /Google Play/i);
});

test('une erreur inconnue garde le message générique', () => {
  assert.match(describePurchaseVerificationError(new Error('boom')), /Contactez le support/i);
});

test('extractPurchaseErrorCode tolère les formes inattendues sans lever', () => {
  assert.equal(extractPurchaseErrorCode(undefined), null);
  assert.equal(extractPurchaseErrorCode({}), null);
  assert.equal(extractPurchaseErrorCode({ response: { data: { detail: 'texte libre' } } }), null);
  assert.equal(
    extractPurchaseErrorCode({ response: { data: { detail: { code: 'X' } } } }),
    'X',
  );
});
