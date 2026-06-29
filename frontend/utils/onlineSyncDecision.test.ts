import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { resolveOnlineSyncAction } from './onlineSyncDecision';

/**
 * C4 — Régression : les mutations offline étaient perdues au redémarrage.
 *
 * Le flush n'était déclenché QUE sur une transition offline→online. Au démarrage,
 * isOnline vaut déjà true (donc wasOffline=false) → les mutations persistées
 * n'étaient jamais rejouées tant que le réseau ne retombait pas puis ne remontait pas.
 */
describe('[REGRESSION] C4 — resolveOnlineSyncAction', () => {
  it('flushe au démarrage (online, sans transition) quand des mutations sont en attente', () => {
    // Scénario exact de la perte de données : app rouverte en ligne, mutations persistées.
    const action = resolveOnlineSyncAction({
      online: true,
      wasOffline: false,
      pendingMutationCount: 2,
    });
    assert.equal(action, 'flush');
  });

  it('flushe sur une transition offline→online avec des mutations en attente', () => {
    const action = resolveOnlineSyncAction({
      online: true,
      wasOffline: true,
      pendingMutationCount: 3,
    });
    assert.equal(action, 'flush');
  });

  it('rafraîchit (fetch) sur une transition offline→online sans mutation en attente', () => {
    const action = resolveOnlineSyncAction({
      online: true,
      wasOffline: true,
      pendingMutationCount: 0,
    });
    assert.equal(action, 'fetch');
  });

  it('ne fait rien sur un event online répété sans transition ni mutation (évite le spam)', () => {
    const action = resolveOnlineSyncAction({
      online: true,
      wasOffline: false,
      pendingMutationCount: 0,
    });
    assert.equal(action, 'none');
  });

  it('ne fait rien quand on passe hors-ligne, même avec des mutations en attente', () => {
    const action = resolveOnlineSyncAction({
      online: false,
      wasOffline: false,
      pendingMutationCount: 5,
    });
    assert.equal(action, 'none');
  });
});
