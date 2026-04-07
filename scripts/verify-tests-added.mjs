#!/usr/bin/env node
import { execSync } from 'node:child_process';

function run(command) {
  return execSync(command, { encoding: 'utf8' }).trim();
}

const baseRef = process.argv[2];
if (!baseRef) {
  console.error('Usage: node scripts/verify-tests-added.mjs <base-ref>');
  process.exit(2);
}

const diffOutput = run(`git diff --name-only ${baseRef}...HEAD`);
const changedFiles = diffOutput ? diffOutput.split('\n').filter(Boolean) : [];

if (changedFiles.length === 0) {
  console.log('No changed files detected.');
  process.exit(0);
}

const isInAppScope = (filePath) => filePath.startsWith('frontend/') || filePath.startsWith('backend/');
const isTestFile = (filePath) =>
  /(^|\/)(__tests__\/.*|.*\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py))$/.test(filePath) ||
  /^backend\/tests\/.+/.test(filePath);

const isCodeLikeFile = (filePath) => /\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(filePath);

const appCodeChanges = changedFiles.filter(
  (filePath) => isInAppScope(filePath) && isCodeLikeFile(filePath) && !isTestFile(filePath),
);

if (appCodeChanges.length === 0) {
  console.log('No frontend/backend app code changes detected.');
  process.exit(0);
}

const changedTests = changedFiles.filter((filePath) => isInAppScope(filePath) && isTestFile(filePath));
if (changedTests.length > 0) {
  console.log('Test changes detected. Policy check passed.');
  console.log(changedTests.map((filePath) => ` - ${filePath}`).join('\n'));
  process.exit(0);
}

console.error('Policy violation: frontend/backend app code changed without test file changes.');
console.error('Changed app code files:');
console.error(appCodeChanges.map((filePath) => ` - ${filePath}`).join('\n'));
console.error('Add or update at least one test file under frontend/ or backend/.');
process.exit(1);
