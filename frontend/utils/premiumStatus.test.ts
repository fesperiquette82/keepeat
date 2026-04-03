import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePremiumStatus } from './premiumStatus.ts';

test('resolvePremiumStatus sort du loading sur erreur générique de sync', () => {
  const snapshot = resolvePremiumStatus({
    token: 'token',
    plan: 'free',
    user: { id: 'u1', email: 'user@example.com', is_premium: false },
    entitlements: null,
    error: 'Network request failed',
  });

  assert.equal(snapshot.isLoading, false);
  assert.equal(snapshot.isPremiumActive, false);
  assert.equal(snapshot.subscriptionStatus, 'inactive');
});

test('resolvePremiumStatus conserve le fallback premium utilisateur après erreur', () => {
  const snapshot = resolvePremiumStatus({
    token: 'token',
    plan: 'free',
    user: { id: 'u1', email: 'premium@example.com', is_premium: true },
    entitlements: null,
    error: 'Error 500',
  });

  assert.equal(snapshot.isLoading, false);
  assert.equal(snapshot.isPremiumActive, true);
  assert.equal(snapshot.subscriptionStatus, 'active');
});
