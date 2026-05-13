#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
  /^backend\/tests\/.+/.test(filePath) ||
  /^tests\/.+/.test(filePath);

const isCodeLikeFile = (filePath) => /\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(filePath);

const appCodeChanges = changedFiles.filter(
  (filePath) => isInAppScope(filePath) && isCodeLikeFile(filePath) && !isTestFile(filePath),
);

const isDocLikeFile = (filePath) =>
  /(^|\/)(README|CHANGELOG|CONTRIBUTING)(\..+)?$/i.test(filePath) || /\.(md|mdx|txt)$/i.test(filePath);

const isPureStyleFile = (filePath) =>
  /\.(css|scss|sass|less)$/.test(filePath) || /\.styles\.(ts|tsx|js|jsx)$/.test(filePath);

const isMinorConfigFile = (filePath) =>
  /(^|\/)(package(-lock)?\.json|tsconfig(\..+)?\.json|eslint\.config\.(js|cjs|mjs)|\.env(\..+)?|\.editorconfig)$/.test(
    filePath,
  ) || /^\.github\/workflows\/.+/.test(filePath);

if (appCodeChanges.length === 0) {
  console.log('No frontend/backend app code changes detected.');
  process.exit(0);
}

const nonExemptAppCodeChanges = appCodeChanges.filter(
  (filePath) => !isDocLikeFile(filePath) && !isPureStyleFile(filePath) && !isMinorConfigFile(filePath),
);

if (nonExemptAppCodeChanges.length === 0) {
  console.log('Only exempt app-scope changes detected (docs/styles/minor-config).');
  process.exit(0);
}

const changedTests = changedFiles.filter((filePath) => isTestFile(filePath));
if (changedTests.length > 0) {
  console.log('Test changes detected. Policy check passed.');
  console.log(changedTests.map((filePath) => ` - ${filePath}`).join('\n'));
  process.exit(0);
}

// Check if corresponding test files exist in the repo for the changed app code
const hasCorrespondingTests = nonExemptAppCodeChanges.every((appFile) => {
  const dir = path.dirname(appFile);
  const filename = path.basename(appFile, path.extname(appFile));
  const possibleTestPaths = [
    path.join(dir, `${filename}.test.ts`),
    path.join(dir, `${filename}.test.tsx`),
    path.join(dir, `${filename}.test.js`),
    path.join(dir, `${filename}.spec.ts`),
    path.join(dir, '__tests__', `${filename}.test.ts`),
  ];
  return possibleTestPaths.some((testPath) => {
    try {
      fs.accessSync(testPath);
      return true;
    } catch {
      return false;
    }
  });
});

if (hasCorrespondingTests) {
  console.log('Corresponding test files found in repository. Policy check passed.');
  process.exit(0);
}

console.error('Policy violation: frontend/backend app code changed without test file changes.');
console.error('Changed app code files:');
console.error(nonExemptAppCodeChanges.map((filePath) => ` - ${filePath}`).join('\n'));
console.error('Add or update at least one test file under frontend/ or backend/.');
process.exit(1);
