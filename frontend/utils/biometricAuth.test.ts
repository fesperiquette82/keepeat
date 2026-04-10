import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBiometricCredentials,
  serializeBiometricCredentials,
  shouldDisplayBiometricLoginButton,
} from './biometricAuth';

test('serializeBiometricCredentials normalise l’email avant persistance', () => {
  const json = serializeBiometricCredentials('  USER@Example.COM ', 'secret123');
  assert.equal(json, '{"email":"user@example.com","password":"secret123"}');
});

test('parseBiometricCredentials rejette les payloads invalides', () => {
  assert.equal(parseBiometricCredentials(null), null);
  assert.equal(parseBiometricCredentials(''), null);
  assert.equal(parseBiometricCredentials('{"email":123,"password":"x"}'), null);
  assert.equal(parseBiometricCredentials('{"email":"a@b.com","password":""}'), null);
  assert.equal(parseBiometricCredentials('not-json'), null);
});

test('parseBiometricCredentials retourne des credentials exploitables', () => {
  assert.deepEqual(
    parseBiometricCredentials('{"email":"  USER@Example.COM ","password":"my-password"}'),
    { email: 'user@example.com', password: 'my-password' },
  );
});

test('shouldDisplayBiometricLoginButton masque le bouton sur web', () => {
  assert.equal(shouldDisplayBiometricLoginButton(true, true, 'web'), false);
  assert.equal(shouldDisplayBiometricLoginButton(false, true, 'ios'), false);
  assert.equal(shouldDisplayBiometricLoginButton(true, false, 'android'), false);
  assert.equal(shouldDisplayBiometricLoginButton(true, true, 'ios'), true);
  assert.equal(shouldDisplayBiometricLoginButton(true, true, 'android'), true);
});
