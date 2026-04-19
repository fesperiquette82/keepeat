#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveCommit() {
  const fromEnv = process.env.EXPO_PUBLIC_APP_COMMIT || process.env.GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveVersion() {
  const fromEnv = process.env.EXPO_PUBLIC_APP_VERSION || process.env.APP_VERSION;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  const appJson = readJson(path.join(process.cwd(), 'app.json'));
  return appJson?.expo?.version || readJson(path.join(process.cwd(), 'package.json')).version || 'unknown';
}

function resolveBuildTime() {
  const fromEnv = process.env.EXPO_PUBLIC_BUILD_TIME || process.env.BUILD_TIME;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return new Date().toISOString();
}

function writeBuildInfo() {
  const outputDir = path.join(process.cwd(), 'public');
  const outputPath = path.join(outputDir, 'build-info.json');
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = {
    commit: resolveCommit(),
    build_time: resolveBuildTime(),
    version: resolveVersion(),
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  process.stdout.write(`build info written: ${outputPath}\n`);
}

writeBuildInfo();
