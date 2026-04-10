import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLogoutConfirmationCopy } from './settingsLogout';

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
