import assert from 'node:assert/strict';
import test from 'node:test';

import appConfig, { embedBundleInDebugGradle, E2E_EMBED_BUNDLE_MARKER, shouldEmbedBundleInDebug } from '../app.config';

// BUG-083 : l'APK debug construit en CI n'embarquait pas le bundle JS (aucun
// Metro en CI) : l'application n'avait rien à exécuter et tous les scénarios
// Maestro échouaient avant l'écran de connexion. Avec EXPO_E2E_EMBED_BUNDLE=1,
// la config Expo attache un plugin qui force le bundling de la variante debug.

const GRADLE_SAMPLE = `
apply plugin: "com.facebook.react"

react {
    entryFile = file(["node", "-e", "require('expo/scripts/resolveAppEntry')"].execute().text.trim())
    bundleCommand = "export:embed"
}
`;

test('BUG-083 : le flag EXPO_E2E_EMBED_BUNDLE pilote le bundling de la variante debug', () => {
  assert.equal(shouldEmbedBundleInDebug({}), false);
  assert.equal(shouldEmbedBundleInDebug({ EXPO_E2E_EMBED_BUNDLE: '0' }), false);
  assert.equal(shouldEmbedBundleInDebug({ EXPO_E2E_EMBED_BUNDLE: '1' }), true);
});

test('BUG-083 : le bloc react {} reçoit debuggableVariants = [] une seule fois', () => {
  const once = embedBundleInDebugGradle(GRADLE_SAMPLE);
  assert.match(once, /react \{\n\s+\/\/ KEEPEAT_E2E_EMBED_BUNDLE\n[\s\S]*debuggableVariants = \[\]/);
  assert.ok(once.includes('bundleCommand = "export:embed"'), 'le reste du bloc est conservé');
  const twice = embedBundleInDebugGradle(once);
  assert.equal(twice, once, 'idempotent : un second prebuild ne duplique pas la directive');
  assert.equal((twice.match(new RegExp(E2E_EMBED_BUNDLE_MARKER, 'g')) || []).length, 1);
});

test('BUG-083 : sans bloc react {}, on échoue bruyamment plutôt que de produire un APK vide', () => {
  assert.throws(() => embedBundleInDebugGradle('android { }'), /react \{/);
});

test('BUG-083 : la config attache le plugin Gradle uniquement en mode E2E', () => {
  const previous = process.env.EXPO_E2E_EMBED_BUNDLE;
  try {
    delete process.env.EXPO_E2E_EMBED_BUNDLE;
    const plain = appConfig() as { mods?: { android?: { appBuildGradle?: unknown } } };
    assert.equal(plain.mods?.android?.appBuildGradle, undefined);

    process.env.EXPO_E2E_EMBED_BUNDLE = '1';
    const e2e = appConfig() as { mods?: { android?: { appBuildGradle?: unknown } } };
    assert.equal(typeof e2e.mods?.android?.appBuildGradle, 'function');
  } finally {
    if (previous === undefined) delete process.env.EXPO_E2E_EMBED_BUNDLE;
    else process.env.EXPO_E2E_EMBED_BUNDLE = previous;
  }
});
