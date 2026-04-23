import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const candidateTestDirs = [
  join(repoRoot, 'frontend', 'utils'),
  join(process.cwd(), 'frontend', 'utils'),
  join(process.cwd(), 'utils'),
];

const testsDir = candidateTestDirs.find((dirPath) => existsSync(dirPath));
if (!testsDir) {
  console.error('Unable to locate frontend test directory. Tried:');
  for (const candidate of candidateTestDirs) {
    console.error(`- ${candidate}`);
  }
  process.exit(1);
}

const allTestFiles = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

const domains = {
  navigation: [/navigation/i, /back/i],
  recipes: [/recipe/i],
  stock: [/stock/i],
  config_and_settings: [/config/i, /settings/i, /theme/i],
  auth_and_admin: [/auth/i, /admin/i, /biometric/i],
};

const counts = Object.fromEntries(Object.keys(domains).map((key) => [key, 0]));

for (const file of allTestFiles) {
  for (const [domain, patterns] of Object.entries(domains)) {
    if (patterns.some((pattern) => pattern.test(file))) {
      counts[domain] += 1;
    }
  }
}

console.log('Frontend non-regression suites summary');
console.log('====================================');
console.log(`Resolved tests directory: ${testsDir}`);
console.log(`Total test files: ${allTestFiles.length}`);
for (const [domain, count] of Object.entries(counts)) {
  console.log(`- ${domain}: ${count}`);
}

const required = ['navigation', 'recipes', 'stock'];
const missing = required.filter((domain) => counts[domain] === 0);
if (missing.length > 0) {
  console.error(`Missing required regression domains: ${missing.join(', ')}`);
  process.exit(1);
}
