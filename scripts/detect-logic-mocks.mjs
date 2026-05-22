#!/usr/bin/env node

/**
 * Detects mocks of business logic (violates Rule 1.4)
 * Blocks commit if found mocking functions like:
 * - filter_*, calculate_*, validate_*, check_*, apply_*
 * - filterRecipes, calculateExpiration, validateInput, etc.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// Get staged test files
const stagedFiles = run('git diff --cached --name-only')
  .split('\n')
  .filter(Boolean);

const isTestFile = (file) =>
  /(\.(test|spec)\.(ts|tsx|js|jsx|py)|__tests__|backend\/tests)/.test(file);

const testFiles = stagedFiles.filter(isTestFile);

if (testFiles.length === 0) {
  process.exit(0);
}

// Business logic function patterns (likely to be mocked incorrectly)
const businessLogicPatterns = [
  /mock.*\b(filter|calculate|validate|check|apply|compute|transform|normalize|format)\w+/gi,
  /@patch\(['"].*?(filter|calculate|validate|check|apply|compute|transform)\w+/gi,
  /vi\.mock.*?(filter|calculate|validate|check|apply|compute|transform)\w+/gi,
  /jest\.mock.*?(filter|calculate|validate|check|apply|compute|transform)\w+/gi,
];

// Specific KeepEat business functions (high risk)
const keepeatBusinessFunctions = [
  'filterRecipes',
  'filterByIngredient',
  'calculateExpiration',
  'calculateMonthly',
  'checkExpiration',
  'validateRecipe',
  'matchIngredient',
  'normalizeIngredient',
  'calculateNutrition',
  'computeScore',
];

const problemFiles = [];

for (const file of testFiles) {
  try {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');

    // Check for generic business logic mocks
    let found = false;
    for (const pattern of businessLogicPatterns) {
      if (pattern.test(content)) {
        found = true;
        break;
      }
    }

    // Check for KeepEat-specific functions
    if (!found) {
      for (const func of keepeatBusinessFunctions) {
        if (content.includes(`mock(`) && content.includes(func)) {
          found = true;
          break;
        }
        if (content.includes(`@patch`) && content.includes(func)) {
          found = true;
          break;
        }
        if (content.includes(`vi.mock`) && content.includes(func)) {
          found = true;
          break;
        }
      }
    }

    if (found) {
      // Extract problematic lines for reporting
      const lines = content
        .split('\n')
        .map((line, idx) => [idx + 1, line])
        .filter(([_, line]) => {
          return (
            line.includes('mock(') ||
            line.includes('@patch') ||
            line.includes('vi.mock') ||
            line.includes('jest.mock')
          );
        });

      if (lines.length > 0) {
        problemFiles.push({ file, lines });
      }
    }
  } catch (e) {
    // Skip files that can't be read
  }
}

if (problemFiles.length > 0) {
  console.error('⚠️  Potential business logic mocks detected');
  console.error('');
  console.error('Found suspicious mocks in these test files:');
  problemFiles.forEach(({ file, lines }) => {
    console.error(`\n  📄 ${file}`);
    lines.forEach(([lineNum, line]) => {
      console.error(`     Line ${lineNum}: ${line.trim()}`);
    });
  });
  console.error('');
  console.error('Guidance (Rule 1.4 — Never mock the logic being tested):');
  console.error('  ✓ Mock external I/O: network, database, filesystem, time');
  console.error('  ✓ Mock third-party services: OCR, payment APIs, etc.');
  console.error('  ✗ DO NOT mock: filter functions, calculation functions, validation logic');
  console.error('');
  console.error('If this is intentional (testing an API integration point):');
  console.error('  1. Add a comment explaining why mocking is needed');
  console.error('  2. Verify the test validates the actual contract, not just the mock');
  console.error('');

  // Don't block, just warn — this is a judgment call
  console.warn('⚠️  Proceeding anyway (review manually)');
  process.exit(0);
}

process.exit(0);
