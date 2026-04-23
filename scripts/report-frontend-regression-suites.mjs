import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const testsDir = join(process.cwd(), 'frontend', 'utils');
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
