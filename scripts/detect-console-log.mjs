#!/usr/bin/env node

/**
 * Detects console.log statements in production code (not tests)
 * Blocks commit if found
 * Allowed: console.error, console.warn (for debugging)
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

// Get staged files
const stagedFiles = run('git diff --cached --name-only')
  .split('\n')
  .filter(Boolean);

// Patterns to exclude (test files, docs, etc.)
const isTestFile = (file) =>
  /(\.(test|spec)\.(ts|tsx|js|jsx)|__tests__|\.maestro|test-utils)/.test(file) ||
  file.includes('/tests/') ||
  file.includes('/mock');

// Patterns to exclude (config, build files)
const isConfigFile = (file) =>
  /\.(config|env|json|yml|yaml|md)$/.test(file) ||
  file.includes('node_modules') ||
  file.includes('.venv') ||
  file.includes('dist');

// Source code extensions
const isSourceCode = (file) => /\.(ts|tsx|js|jsx|py|mjs|cjs)$/.test(file);

const productionFiles = stagedFiles.filter(
  (file) => isSourceCode(file) && !isTestFile(file) && !isConfigFile(file)
);

if (productionFiles.length === 0) {
  process.exit(0);
}

// Check for console.log in each file
const consoleLogPattern = /console\.log\s*\(/gi;
const problemFiles = [];

for (const file of productionFiles) {
  try {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');

    // Check for console.log (not console.error or console.warn)
    const matches = content.match(/^.*console\.log\s*\(.*$/gm);
    if (matches) {
      // Make sure it's not in a comment
      const activeMatches = matches.filter((line) => !line.trim().startsWith('//'));
      if (activeMatches.length > 0) {
        problemFiles.push({
          file,
          lines: activeMatches,
        });
      }
    }
  } catch (e) {
    // Skip files that can't be read
  }
}

if (problemFiles.length > 0) {
  console.error('❌ Console.log detected in production code');
  console.error('');
  console.error('Found console.log in these files:');
  problemFiles.forEach(({ file, lines }) => {
    console.error(`\n  📄 ${file}`);
    lines.forEach((line) => {
      console.error(`     ${line.trim()}`);
    });
  });
  console.error('');
  console.error('Guidance:');
  console.error('  • For debugging: Use DEBUG=keepeat:* environment variable');
  console.error('  • For logging: Use the centralized logger (logger from utils/logger.ts)');
  console.error('  • If truly needed: Use console.error() for errors only');
  console.error('');
  console.error('Remove console.log before committing.');
  process.exit(1);
}

process.exit(0);
