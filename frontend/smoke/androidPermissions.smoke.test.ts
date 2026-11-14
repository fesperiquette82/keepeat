import assert from 'node:assert/strict';
import test from 'node:test';

import appConfig from '../app.config';

// BUG-078 : app.json déclarait SCHEDULE_EXACT_ALARM et USE_EXACT_ALARM alors
// qu'aucune alarme exacte n'est programmée (les rappels utilisent des
// déclencheurs date / intervalle classiques). Google Play réserve USE_EXACT_ALARM
// aux réveils, minuteurs et calendriers : une déclaration injustifiée expose
// l'application à un rejet lors de la revue.
const FORBIDDEN_PERMISSIONS = [
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
];

test('smoke frontend: aucune permission d’alarme exacte n’est déclarée', () => {
  const config = appConfig();
  const permissions: string[] = config.android?.permissions ?? [];
  for (const permission of FORBIDDEN_PERMISSIONS) {
    assert.ok(!permissions.includes(permission), `${permission} ne doit pas être déclarée`);
  }
});

test('smoke frontend: les permissions réellement utilisées restent déclarées', () => {
  const config = appConfig();
  const permissions: string[] = config.android?.permissions ?? [];
  for (const permission of ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS', 'com.android.vending.BILLING']) {
    assert.ok(permissions.includes(permission), `${permission} doit rester déclarée`);
  }
});
