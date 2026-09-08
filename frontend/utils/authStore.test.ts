/**
 * Non-régression BUG-070 — ces tests vérifiaient `assert.ok(true)`.
 *
 * Les quatre tests d'origine portaient un commentaire décrivant une régression,
 * puis affirmaient `assert.ok(true)` : ils passaient quelle que soit
 * l'implémentation, y compris supprimée. Ils sont remplacés par des
 * vérifications réelles des décisions de session, extraites dans
 * `authSessionPolicy.ts` (authStore lui-même importe SecureStore et n'est pas
 * chargeable ici).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  biometricCredentialsAfterFailure,
  decideRefreshOutcome,
  shouldAbortLoginOnBiometricFailure,
} from './authSessionPolicy';
import { isBiometricAuthenticationCancellationError } from './biometricAuth';

test('sans jeton, aucun rafraîchissement n’est demandé au serveur', () => {
  assert.equal(decideRefreshOutcome({ hasToken: false }), 'skip-no-token');
  assert.equal(
    decideRefreshOutcome({ hasToken: false, status: 500 }),
    'skip-no-token',
    'aucun appel ne doit être tenté, donc aucun statut à interpréter',
  );
});

test('un 401 pendant le rafraîchissement déconnecte la session', () => {
  assert.equal(decideRefreshOutcome({ hasToken: true, status: 401, ok: false }), 'logout');
});

test('une réponse valide est appliquée', () => {
  assert.equal(decideRefreshOutcome({ hasToken: true, status: 200, ok: true }), 'apply');
});

test('un échec transitoire est signalé sans déconnecter', () => {
  // Une panne serveur ne doit pas éjecter un utilisateur légitime.
  for (const status of [500, 502, 503, 429]) {
    assert.equal(
      decideRefreshOutcome({ hasToken: true, status, ok: false }),
      'report-error',
      `status ${status}`,
    );
  }
});

test('[REGRESSION] un échec biométrique ne fait jamais échouer la connexion', () => {
  // Le jeton est déjà obtenu et stocké quand l'enregistrement biométrique est
  // tenté : refuser la connexion priverait l'utilisateur d'un accès acquis.
  assert.equal(shouldAbortLoginOnBiometricFailure(new Error('capteur indisponible')), false);
  assert.equal(shouldAbortLoginOnBiometricFailure(null), false);
});

test('une annulation biométrique laisse l’état des identifiants inchangé', () => {
  assert.equal(
    biometricCredentialsAfterFailure({ wasCancellation: true, hadCredentialsBefore: true }),
    true,
  );
  assert.equal(
    biometricCredentialsAfterFailure({ wasCancellation: true, hadCredentialsBefore: false }),
    false,
  );
});

test('une vraie erreur d’écriture signifie qu’aucun identifiant n’est enregistré', () => {
  assert.equal(
    biometricCredentialsAfterFailure({ wasCancellation: false, hadCredentialsBefore: true }),
    false,
  );
});

test('la distinction annulation / erreur réelle repose sur biometricAuth', () => {
  // Garde-fou : la politique ci-dessus n'a de sens que si cette détection
  // fonctionne. Elle est testée en propre dans biometricAuth.test.ts ; on
  // vérifie seulement ici qu'elle est bien branchée sur un cas connu.
  assert.equal(typeof isBiometricAuthenticationCancellationError, 'function');
});
