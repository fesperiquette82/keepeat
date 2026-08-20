import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-051 — import automatique des tickets par boîte mail dédiée, alternative
// retenue à la connexion Gmail (BUG-050) après revue RGPD : geste actif de
// transfert d'email plutôt qu'une lecture automatisée de boîte via OAuth.
// ---------------------------------------------------------------------------

test('emailImportApi.ts appelle le bon endpoint', () => {
  const src = readSource('utils/emailImportApi.ts');
  assert.match(src, /\/api\/integrations\/email-import\/address/);
});

test("emailImportApi.ts fait passer son appel par fetchWithTimeout", () => {
  const src = readSource('utils/emailImportApi.ts');
  assert.match(src, /^import \{ fetchWithTimeout as fetch \} from '\.\/fetchWithTimeout';/m);
});

test("l'écran email-import.tsx propose de partager l'adresse (pas de dépendance clipboard ajoutée)", () => {
  const src = readSource('app/email-import.tsx');
  assert.match(src, /import \{ .*Share.* \} from 'react-native';/);
  assert.match(src, /Share\.share\(/);
  assert.match(src, /fetchEmailImportAddress/);
});

test("settings.tsx pointe vers l'écran email-import, plus vers gmail-connect", () => {
  const src = readSource('app/settings.tsx');
  assert.match(src, /router\.push\('\/email-import'\)/);
  assert.doesNotMatch(src, /router\.push\('\/gmail-connect'\)/);
});
