import test from 'node:test';
import assert from 'node:assert/strict';

function loadAppConfigModule() {
  const modulePath = require.resolve('./appConfig');
  delete require.cache[modulePath];
  return require('./appConfig') as typeof import('./appConfig');
}

test('en variante prod, les debug tools restent désactivés même si le flag est forcé', () => {
  const previousVariant = process.env.EXPO_PUBLIC_APP_VARIANT;
  const previousDebugFlag = process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS;
  const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  process.env.EXPO_PUBLIC_APP_VARIANT = 'prod';
  process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS = 'true';
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;

  const { APP_CONFIG } = loadAppConfigModule();
  assert.equal(APP_CONFIG.appVariant, 'prod');
  assert.equal(APP_CONFIG.enableDebugTools, false);
  assert.equal(APP_CONFIG.enableDiagnosticScreen, false);

  process.env.EXPO_PUBLIC_APP_VARIANT = previousVariant;
  process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS = previousDebugFlag;
  (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
});

test('en variante debug, les debug tools peuvent être activés explicitement', () => {
  const previousVariant = process.env.EXPO_PUBLIC_APP_VARIANT;
  const previousDebugFlag = process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS;
  const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  process.env.EXPO_PUBLIC_APP_VARIANT = 'debug';
  process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS = 'true';
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;

  const { APP_CONFIG } = loadAppConfigModule();
  assert.equal(APP_CONFIG.appVariant, 'debug');
  assert.equal(APP_CONFIG.enableDebugTools, true);

  process.env.EXPO_PUBLIC_APP_VARIANT = previousVariant;
  process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS = previousDebugFlag;
  (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
});
