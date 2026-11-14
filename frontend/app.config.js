const { execSync } = require('node:child_process');
const appJson = require('./app.json');

// BUG-083 : la variante debug n'embarque pas le bundle JS par défaut (le plugin
// Gradle de React Native la laisse charger le code depuis Metro). En CI aucun
// Metro ne tourne : l'APK E2E n'avait donc jamais de code à exécuter, et tous
// les scénarios Maestro échouaient avant même l'écran de connexion. Quand
// EXPO_E2E_EMBED_BUNDLE=1, ce plugin de configuration force `export:embed` pour
// la variante debug ; en développement local, Metro reste utilisé.
const E2E_EMBED_BUNDLE_MARKER = '// KEEPEAT_E2E_EMBED_BUNDLE';

/** @param {Record<string, string | undefined>} [env] */
function shouldEmbedBundleInDebug(env = process.env) {
  return env.EXPO_E2E_EMBED_BUNDLE === '1';
}

function embedBundleInDebugGradle(contents) {
  if (contents.includes(E2E_EMBED_BUNDLE_MARKER)) return contents;
  if (!/\breact\s*\{/.test(contents)) {
    throw new Error("BUG-083 : bloc `react {` introuvable dans android/app/build.gradle");
  }
  return contents.replace(
    /\breact\s*\{/,
    `react {\n    ${E2E_EMBED_BUNDLE_MARKER}\n    // BUG-083 : APK E2E — embarquer le bundle JS dans la variante debug (pas de Metro en CI).\n    debuggableVariants = []\n`,
  );
}

function withEmbeddedBundleInDebug(config) {
  // Chargé à la demande : le smoke test Node de la config n'a pas besoin de cette dépendance.
  const { withAppBuildGradle } = require('expo/config-plugins');
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language === 'groovy') {
      mod.modResults.contents = embedBundleInDebugGradle(mod.modResults.contents);
    }
    return mod;
  });
}

function getGitCommit() {
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

module.exports = () => {
  const expoConfig = { ...appJson.expo };
  const version = process.env.EXPO_PUBLIC_APP_VERSION || process.env.APP_VERSION || expoConfig.version;
  const commit = process.env.EXPO_PUBLIC_APP_COMMIT || process.env.GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || getGitCommit() || 'unavailable';
  const buildTime = process.env.EXPO_PUBLIC_BUILD_TIME || process.env.BUILD_TIME || new Date().toISOString();

  const config = {
    ...expoConfig,
    version,
    extra: {
      ...(expoConfig.extra || {}),
      appVersion: version,
      appCommit: commit,
      buildTime,
    },
  };

  return shouldEmbedBundleInDebug() ? withEmbeddedBundleInDebug(config) : config;
};

module.exports.shouldEmbedBundleInDebug = shouldEmbedBundleInDebug;
module.exports.embedBundleInDebugGradle = embedBundleInDebugGradle;
module.exports.E2E_EMBED_BUNDLE_MARKER = E2E_EMBED_BUNDLE_MARKER;
