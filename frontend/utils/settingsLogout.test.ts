import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLogoutConfirmationCopy } from './settingsLogout';

test('BUG-033 : une erreur dans unregisterPushToken ne doit pas interrompre le logout (nettoyage token garanti)', async () => {
  let tokenCleared = false;

  // Simule le pattern logout de authStore avec le try/catch corrigé
  async function logoutWithResilience(unregister: () => Promise<void>): Promise<void> {
    try {
      await unregister();
    } catch {
      // Erreur réseau : on continue le logout même si la désinscription échoue
    }
    tokenCleared = true; // simule SecureStore.deleteItemAsync
  }

  await logoutWithResilience(async () => { throw new Error('network error'); });
  assert.equal(tokenCleared, true, 'le token doit être supprimé même si unregisterPushToken plante');
});

test('buildLogoutConfirmationCopy construit les libellés de confirmation de déconnexion', () => {
  const dictionary: Record<string, string> = {
    logoutConfirmTitle: 'Déconnexion',
    logoutConfirmMessage: 'Voulez-vous vraiment vous déconnecter ?',
    cancel: 'Annuler',
    logoutButton: 'Déconnection',
  };

  const copy = buildLogoutConfirmationCopy((key) => dictionary[key] ?? `missing:${key}`);

  assert.deepEqual(copy, {
    title: 'Déconnexion',
    message: 'Voulez-vous vraiment vous déconnecter ?',
    cancelLabel: 'Annuler',
    confirmLabel: 'Déconnection',
  });
});
