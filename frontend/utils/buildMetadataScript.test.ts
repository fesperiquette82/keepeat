import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const buildInfoPath = path.join(repoRoot, 'public', 'build-info.json');

test('build metadata script generates readable file with stable fields', () => {
  const previous = fs.existsSync(buildInfoPath) ? fs.readFileSync(buildInfoPath, 'utf8') : null;
  try {
    execFileSync('node', ['./scripts/generate-build-info.js'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        EXPO_PUBLIC_APP_COMMIT: 'testcommit123',
        EXPO_PUBLIC_BUILD_TIME: '2026-04-19T12:00:00Z',
        EXPO_PUBLIC_APP_VERSION: '9.9.9',
      },
    });
    const raw = fs.readFileSync(buildInfoPath, 'utf8');
    const payload = JSON.parse(raw) as Record<string, string>;
    assert.deepEqual(payload, {
      commit: 'testcommit123',
      build_time: '2026-04-19T12:00:00Z',
      version: '9.9.9',
    });
  } finally {
    if (previous === null) {
      fs.rmSync(buildInfoPath, { force: true });
    } else {
      fs.writeFileSync(buildInfoPath, previous, 'utf8');
    }
  }
});
