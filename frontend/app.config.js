const { execSync } = require('node:child_process');
const appJson = require('./app.json');

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

  return {
    ...expoConfig,
    version,
    extra: {
      ...(expoConfig.extra || {}),
      appVersion: version,
      appCommit: commit,
      buildTime,
    },
  };
};
