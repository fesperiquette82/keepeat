import test from 'node:test';
import assert from 'node:assert/strict';

// BUG-090 : le bundle embarqué dans l'APK E2E (BUG-083) est compilé en mode
// production : __DEV__ est faux et NODE_ENV est inliné à « production ». Sans
// environnement explicite, l'application se range en production, le garde-fou
// rejette l'URL du backend de test et l'application vise le backend de
// PRODUCTION. Ces tests reproduisent exactement ces conditions.

const ENV_KEYS = [
  'NODE_ENV',
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_APP_VARIANT',
  'EXPO_PUBLIC_BACKEND_URL',
  'EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT',
  'EXPO_PUBLIC_BACKEND_URL_STAGING',
  'EXPO_PUBLIC_BACKEND_URL_PRODUCTION',
  'EXPO_PUBLIC_ALLOWED_PROD_API_URLS',
] as const;

const E2E_BACKEND_URL = 'http://10.0.2.2:8000';
const PRODUCTION_BACKEND_URL = 'https://keepeat-backend.onrender.com';

type ConfigModule = typeof import('./config');
type AppConfigModule = typeof import('./appConfig');

function loadWithEnv(
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  isDev: boolean,
): { config: ConfigModule; appConfig: AppConfigModule } {
  const saved = ENV_KEYS.map(key => [key, process.env[key]] as const);
  const globals = globalThis as { __DEV__?: boolean };
  const savedDev = globals.__DEV__;
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globals.__DEV__ = isDev;
  try {
    for (const name of ['./config', './appConfig']) {
      delete require.cache[require.resolve(name)];
    }
    /* eslint-disable @typescript-eslint/no-require-imports -- rechargement volontaire des modules pour chaque jeu de variables */
    return {
      config: require('./config') as ConfigModule,
      appConfig: require('./appConfig') as AppConfigModule,
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globals.__DEV__ = savedDev;
  }
}

test('bundle de production sans environnement explicite : l’URL de test est rejetée au profit de la production', () => {
  const { config } = loadWithEnv(
    { NODE_ENV: 'production', EXPO_PUBLIC_BACKEND_URL: E2E_BACKEND_URL },
    false,
  );
  assert.equal(config.API_ENV, 'production');
  assert.equal(config.API_URL_GUARDRAIL_STATUS, 'blocked');
  assert.equal(config.API_URL, PRODUCTION_BACKEND_URL);
});

test('[REGRESSION BUG-090] bundle E2E avec EXPO_PUBLIC_APP_ENV=development : vise le backend de test', () => {
  const { config, appConfig } = loadWithEnv(
    {
      NODE_ENV: 'production',
      EXPO_PUBLIC_APP_ENV: 'development',
      EXPO_PUBLIC_BACKEND_URL: E2E_BACKEND_URL,
    },
    false,
  );
  assert.equal(config.API_ENV, 'development');
  assert.equal(config.API_URL_GUARDRAIL_STATUS, 'ok');
  assert.equal(config.API_URL, E2E_BACKEND_URL);
  // L'application reste en variante « prod » : pas d'outils de debug à l'écran
  // qui modifieraient ce que les scénarios Maestro voient.
  assert.equal(appConfig.APP_CONFIG.appVariant, 'prod');
  assert.equal(appConfig.APP_CONFIG.enableDebugTools, false);
});

test('un build de production réel garde son garde-fou : une URL non autorisée reste rejetée', () => {
  const { config } = loadWithEnv(
    {
      NODE_ENV: 'production',
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_BACKEND_URL: E2E_BACKEND_URL,
    },
    false,
  );
  assert.equal(config.API_URL_GUARDRAIL_STATUS, 'blocked');
  assert.equal(config.API_URL, PRODUCTION_BACKEND_URL);
});
