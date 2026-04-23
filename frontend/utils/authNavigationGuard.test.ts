import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTH_PUBLIC_SCREENS, resolveAuthRedirect } from './authNavigationGuard';

test('ne redirige jamais tant que l’état auth n’est pas chargé', () => {
  const redirect = resolveAuthRedirect({ isLoaded: false, hasUser: false, firstSegment: undefined });
  assert.equal(redirect, null);
});

test('redirige vers /login quand utilisateur absent sur écran privé', () => {
  assert.equal(resolveAuthRedirect({ isLoaded: true, hasUser: false, firstSegment: '(tabs)' }), '/login');
  assert.equal(resolveAuthRedirect({ isLoaded: true, hasUser: false, firstSegment: 'settings' }), '/login');
});

test('ne redirige pas vers /login sur écrans publics sans utilisateur', () => {
  for (const segment of AUTH_PUBLIC_SCREENS) {
    assert.equal(resolveAuthRedirect({ isLoaded: true, hasUser: false, firstSegment: segment }), null);
  }
});

test('redirige un utilisateur connecté quittant login/register vers /', () => {
  assert.equal(resolveAuthRedirect({ isLoaded: true, hasUser: true, firstSegment: 'login' }), '/');
  assert.equal(resolveAuthRedirect({ isLoaded: true, hasUser: true, firstSegment: 'register' }), '/');
});

test('ne force pas de redirection pour utilisateur connecté sur autres écrans', () => {
  assert.equal(resolveAuthRedirect({ isLoaded: true, hasUser: true, firstSegment: '(tabs)' }), null);
  assert.equal(resolveAuthRedirect({ isLoaded: true, hasUser: true, firstSegment: 'premium' }), null);
});

test('respecte une liste custom d’écrans publics', () => {
  const redirect = resolveAuthRedirect({
    isLoaded: true,
    hasUser: false,
    firstSegment: 'custom-public',
    publicScreens: ['custom-public'],
  });

  assert.equal(redirect, null);
});
