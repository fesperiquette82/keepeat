#!/usr/bin/env node

/**
 * Validate test coverage for user-visible bugs
 *
 * Rule: If a bug is visible to the user, the fix must include:
 * 1. Unit test (smallest logic involved)
 * 2. Integration/contract test (data boundary)
 * 3. UI or E2E test (visible behavior)
 *
 * Heuristics for "user-visible bug":
 * - Frontend code change (app/, components/, screens/)
 * - User-facing API change (not internal utils)
 * - Commit message contains "fix"
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function log(...args) {
  console.error('[visible-bug-coverage]', ...args);
}

// Get commit message from stdin (passed by git hook)
const commitMsgFile = process.argv[2];
if (!commitMsgFile) {
  // Not in commit-msg context, skip (pre-commit context)
  process.exit(0);
}

let commitMsg = '';
try {
  commitMsg = fs.readFileSync(commitMsgFile, 'utf8').trim();
} catch {
  process.exit(0);
}

// Only validate "fix" commits
if (!commitMsg.toLowerCase().includes('fix')) {
  process.exit(0);
}

// Get changed files in this commit
const diffOutput = run('git diff --cached --name-only');
const changedFiles = diffOutput ? diffOutput.split('\n').filter(Boolean) : [];

if (changedFiles.length === 0) {
  process.exit(0);
}

// Determine if this is a user-visible bug
const isUserVisibleBug = (files) => {
  // Frontend app code (directly visible to user)
  const frontendAppPattern = /^frontend\/(app|components|screens|utils\/[^/]*\.(ts|tsx)$)/;

  // API routes that change user-visible behavior
  const apiPattern = /^backend\/.*route.*\.(py|mjs)$|^backend\/server\.py$/;

  const appChanges = files.filter((f) => frontendAppPattern.test(f));
  const apiChanges = files.filter((f) => apiPattern.test(f));

  return appChanges.length > 0 || apiChanges.length > 0;
};

if (!isUserVisibleBug(changedFiles)) {
  // Internal fix (utils, types, etc.) - less strict requirements
  process.exit(0);
}

// User-visible bug detected - validate 3-level coverage
log('User-visible bug detected in fix commit');
log(`Changed files: ${changedFiles.join(', ')}`);

// Check for test files at 3 levels
const testFiles = changedFiles.filter(
  (f) =>
    /(\.(test|spec)\.(ts|tsx|js|py)|__tests__|\/tests\/)/.test(f) ||
    f.startsWith('frontend/integration/') ||
    f.startsWith('frontend/smoke/') ||
    f.startsWith('frontend/__tests__/') ||
    f.startsWith('backend/tests/')
);

if (testFiles.length === 0) {
  console.warn('⚠️  User-visible bug fix detected without test files');
  console.warn('');
  console.warn('For user-visible bugs, provide tests at 3 levels:');
  console.warn('  1️⃣  Unit test — smallest logic (function, hook, utility)');
  console.warn('  2️⃣  Integration test — data boundary (component interaction, API contract)');
  console.warn('  3️⃣  UI/E2E test — visible behavior (Maestro, screen state)');
  console.warn('');
  console.warn('Examples:');
  console.warn('  • Bug in swipe handler:');
  console.warn('    - Unit: Test direction->action mapping');
  console.warn('    - Integration: Test stock state change');
  console.warn('    - E2E: Test swipe gesture on actual UI');
  console.warn('  • Bug in recipe filter:');
  console.warn('    - Unit: Test filter logic');
  console.warn('    - Integration: Test API returns filtered results');
  console.warn('    - UI: Test filtered list displays correctly');
  console.warn('');
  console.warn('Note: This is a warning. Fix it before merge, but commit is allowed.');
  process.exit(0);
}

// Heuristic: categorize test files
const hasUnitTest = testFiles.some(
  (f) =>
    /^frontend\/__tests__\/utils\/.*\.(test|spec)/.test(f) ||
    /^backend\/tests\/test_.*\.py$/.test(f)
);

const hasIntegrationTest = testFiles.some(
  (f) =>
    /^frontend\/(integration|__tests__\/components|__tests__\/screens)\//.test(f) ||
    /^backend\/tests\/test_.*\.(py)$/.test(f)
);

const hasUIorE2ETest = testFiles.some(
  (f) =>
    /^frontend\/(smoke|__tests__\/screens)\//.test(f) ||
    /^\.maestro\//.test(f) ||
    /\.maestro\.yml/.test(f)
);

log(`Test coverage: Unit=${hasUnitTest}, Integration=${hasIntegrationTest}, UI/E2E=${hasUIorE2ETest}`);

// Report findings
const missing = [];
if (!hasUnitTest) missing.push('unit');
if (!hasIntegrationTest) missing.push('integration');
if (!hasUIorE2ETest) missing.push('UI/E2E');

if (missing.length > 0) {
  console.warn(`⚠️  Missing test levels for user-visible bug: ${missing.join(', ')}`);
  console.warn('');
  console.warn('Test files detected:');
  testFiles.forEach((f) => console.warn(`  • ${f}`));
  console.warn('');
  console.warn('Guidance:');
  if (!hasUnitTest) {
    console.warn('  • Add unit test (frontend/__tests__/utils/ or backend/tests/)');
  }
  if (!hasIntegrationTest) {
    console.warn('  • Add integration test (frontend/integration/ or backend/tests/)');
  }
  if (!hasUIorE2ETest) {
    console.warn('  • Add UI/E2E test (frontend/smoke/ or .maestro/)');
  }
  console.warn('');
  process.exit(0);
}

log('✅ All 3 test levels present for user-visible bug');
process.exit(0);
