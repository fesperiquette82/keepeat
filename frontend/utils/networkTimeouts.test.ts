import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-038 — aucun appel réseau (axios ou fetch) n'avait de timeout : un
// backend lent ou indisponible pouvait laisser un écran de chargement
// indéfiniment (symptôme observé sur frontend/app/recipes/[id].tsx, BUG-035).
// ---------------------------------------------------------------------------

test('httpDefaults.ts fixe axios.defaults.timeout sur le singleton axios importé', () => {
  const src = readSource('utils/httpDefaults.ts');
  assert.match(src, /^import axios from 'axios';/m);
  assert.match(src, /axios\.defaults\.timeout\s*=\s*\d+/);
});

test("app/_layout.tsx importe httpDefaults en tout premier (avant tout appel réseau)", () => {
  const src = readSource('app/_layout.tsx');
  const firstImportLine = src.split('\n').find((line) => line.trim().startsWith('import'));
  assert.equal(firstImportLine?.trim(), "import '../utils/httpDefaults';");
});

const FETCH_TIMEOUT_FILES = [
  { file: 'app/_layout.tsx', importPath: '../utils/fetchWithTimeout' },
  { file: 'app/premium.tsx', importPath: '../utils/fetchWithTimeout' },
  { file: 'store/authStore.ts', importPath: '../utils/fetchWithTimeout' },
  { file: 'utils/accountService.ts', importPath: './fetchWithTimeout' },
  { file: 'utils/adminMonitoringApi.ts', importPath: './fetchWithTimeout' },
  { file: 'utils/billingService.ts', importPath: './fetchWithTimeout' },
  { file: 'utils/debugLogsBackendUpload.ts', importPath: './fetchWithTimeout' },
  { file: 'utils/debugLogsGitHubSync.ts', importPath: './fetchWithTimeout' },
  { file: 'utils/notificationService.ts', importPath: './fetchWithTimeout' },
];

for (const { file, importPath } of FETCH_TIMEOUT_FILES) {
  test(`${file} fait passer ses appels fetch(...) par fetchWithTimeout`, () => {
    const src = readSource(file);
    const expectedImport = `import { fetchWithTimeout as fetch } from '${importPath}';`;
    assert.ok(
      src.includes(expectedImport),
      `${file} doit contenir : ${expectedImport}`,
    );
  });
}
