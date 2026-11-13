import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideBiometricSessionOutcome,
  isBiometricAuthenticationCancellationError,
  isLegacyBiometricPayload,
  parseBiometricSession,
  serializeBiometricSession,
  shouldDisplayBiometricLoginButton,
} from './biometricAuth';

// BUG-082 : la charge utile biométrique contient un jeton, jamais le mot de passe.

test('serializeBiometricSession normalise l’email et ne contient aucun mot de passe', () => {
  const json = serializeBiometricSession('  USER@Example.COM ', 'jwt-abc');
  assert.equal(json, '{"email":"user@example.com","token":"jwt-abc"}');
  assert.ok(!json.includes('password'));
});

test('parseBiometricSession rejette les payloads invalides', () => {
  assert.equal(parseBiometricSession(null), null);
  assert.equal(parseBiometricSession(''), null);
  assert.equal(parseBiometricSession('{"email":123,"token":"x"}'), null);
  assert.equal(parseBiometricSession('{"email":"a@b.com","token":""}'), null);
  assert.equal(parseBiometricSession('{"email":"a@b.com"}'), null);
  assert.equal(parseBiometricSession('not-json'), null);
  assert.equal(parseBiometricSession('[]'), null);
});

test('parseBiometricSession retourne une session exploitable', () => {
  assert.deepEqual(
    parseBiometricSession('{"email":"  USER@Example.COM ","token":" jwt-abc "}'),
    { email: 'user@example.com', token: 'jwt-abc' },
  );
});

test('[REGRESSION BUG-082] une charge utile héritée (mot de passe) n’est jamais une session valide', () => {
  const legacy = '{"email":"user@example.com","password":"my-password"}';
  assert.equal(parseBiometricSession(legacy), null);
  assert.equal(isLegacyBiometricPayload(legacy), true);
  // Même accompagnée d'un jeton, la présence d'un mot de passe disqualifie la charge utile.
  assert.equal(parseBiometricSession('{"email":"a@b.com","token":"t","password":"p"}'), null);
});

test('isLegacyBiometricPayload ne se déclenche que sur un objet portant un mot de passe', () => {
  assert.equal(isLegacyBiometricPayload(null), false);
  assert.equal(isLegacyBiometricPayload('not-json'), false);
  assert.equal(isLegacyBiometricPayload('{"email":"a@b.com","token":"t"}'), false);
  assert.equal(isLegacyBiometricPayload('{"password":""}'), true);
});

test('decideBiometricSessionOutcome : 401 efface la session, le reste la conserve', () => {
  assert.equal(decideBiometricSessionOutcome({ status: 200, ok: true }), 'ok');
  assert.equal(decideBiometricSessionOutcome({ status: 401, ok: false }), 'expired');
  assert.equal(decideBiometricSessionOutcome({ status: 503, ok: false }), 'unavailable');
  assert.equal(decideBiometricSessionOutcome({ status: null }), 'unavailable');
  assert.equal(decideBiometricSessionOutcome({}), 'unavailable');
});

test('shouldDisplayBiometricLoginButton masque le bouton sur web', () => {
  assert.equal(shouldDisplayBiometricLoginButton(true, true, 'web'), false);
  assert.equal(shouldDisplayBiometricLoginButton(true, true, 'android'), true);
  assert.equal(shouldDisplayBiometricLoginButton(false, true, 'android'), false);
  assert.equal(shouldDisplayBiometricLoginButton(true, false, 'android'), false);
});

test('isBiometricAuthenticationCancellationError détecte les annulations biométriques connues', () => {
  assert.equal(isBiometricAuthenticationCancellationError(new Error('Could not Authenticate the user')), true);
  assert.equal(isBiometricAuthenticationCancellationError(new Error("Opération d'empreinte digitale annulée par l'utilisateur")), true);
  assert.equal(isBiometricAuthenticationCancellationError(new Error('Authentication canceled')), true);
  assert.equal(isBiometricAuthenticationCancellationError(new Error('User canceled authentication')), true);
  assert.equal(isBiometricAuthenticationCancellationError(new Error('Keystore unavailable')), false);
  assert.equal(isBiometricAuthenticationCancellationError(null), false);
  assert.equal(isBiometricAuthenticationCancellationError('string'), false);
});
