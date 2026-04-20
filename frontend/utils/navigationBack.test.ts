import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBackNavigationAction } from './navigationBack';

test('resolveBackNavigationAction retourne back quand un historique est disponible', () => {
  const action = resolveBackNavigationAction({ canGoBack: true, fallbackHref: '/fallback' });
  assert.deepEqual(action, { type: 'back' });
});

test('resolveBackNavigationAction retourne replace vers le fallback quand aucun historique n’existe', () => {
  const action = resolveBackNavigationAction({ canGoBack: false, fallbackHref: '/fallback' });
  assert.deepEqual(action, { type: 'replace', href: '/fallback' });
});

test('resolveBackNavigationAction utilise le fallback par défaut si non fourni', () => {
  const action = resolveBackNavigationAction({ canGoBack: false });
  assert.deepEqual(action, { type: 'replace', href: '/(tabs)/recipes' });
});
