import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-049 (partage foyer) / BUG-050 (import mail des tickets) — phase 1.
// Vérifications de câblage minimales : endpoints appelés, navigation en place,
// scope OAuth correct. La logique métier (quota, résolution du plan via le
// propriétaire) est couverte côté backend (test_household_sharing.py,
// test_gmail_oauth.py) — ici on garde le fil entre l'écran et l'API.
// ---------------------------------------------------------------------------

test('householdApi.ts appelle les bons endpoints /api/household', () => {
  const src = readSource('utils/householdApi.ts');
  assert.match(src, /buildApiUrl\('\/api\/household'\)/);
  assert.match(src, /buildApiUrl\('\/api\/household\/invite'\)/);
  assert.match(src, /buildApiUrl\('\/api\/household\/join'\)/);
  assert.match(src, /buildApiUrl\('\/api\/household\/leave'\)/);
});

test('householdStore.ts expose create/invite/join/leave/refresh', () => {
  const src = readSource('store/householdStore.ts');
  for (const fn of ['refresh:', 'create:', 'invite:', 'join:', 'leave:']) {
    assert.ok(src.includes(fn), `householdStore doit exposer ${fn}`);
  }
});

test('household.tsx réserve le bouton d’invitation au propriétaire du foyer', () => {
  const src = readSource('app/household.tsx');
  assert.match(src, /isOwner\s*=\s*!!household\s*&&\s*household\.owner_id\s*===\s*currentUserId/);
  assert.match(src, /isOwner\s*&&\s*\(/);
});

test('settings.tsx propose un accès au foyer', () => {
  const src = readSource('app/settings.tsx');
  assert.match(src, /router\.push\('\/household'\)/);
});

// settings.tsx pointe désormais vers /email-import (BUG-051, boîte mail dédiée)
// plutôt que /gmail-connect — cf. emailImportScreen.test.ts. L'écran et les
// endpoints Gmail (ci-dessous) restent dans le dépôt, non branchés depuis les
// réglages : cf. AUDIT_BUGS.md, phase 2 Gmail mise en pause après revue RGPD.

test('gmailApi.ts appelle les bons endpoints /api/integrations/gmail', () => {
  const src = readSource('utils/gmailApi.ts');
  assert.match(src, /buildApiUrl\('\/api\/integrations\/gmail\/auth-url'\)/);
  assert.match(src, /buildApiUrl\('\/api\/integrations\/gmail\/connect'\)/);
  assert.match(src, /buildApiUrl\('\/api\/integrations\/gmail\/status'\)/);
  assert.match(src, /buildApiUrl\('\/api\/integrations\/gmail\/disconnect'\)/);
});

test('gmail-connect.tsx utilise le scope readonly via le backend (jamais un scope plus large en dur côté app)', () => {
  const src = readSource('app/gmail-connect.tsx');
  assert.ok(!src.includes('gmail.modify') && !src.includes('gmail.send'), 'aucun scope Gmail en écriture ne doit apparaître côté app');
});

test('gmail-connect.tsx ouvre la session OAuth avec le schéma de redirection de l’app (keepeat://)', () => {
  const src = readSource('app/gmail-connect.tsx');
  assert.match(src, /WebBrowser\.openAuthSessionAsync\(authorization_url,\s*'keepeat:\/\/oauth\/gmail\/callback'\)/);
});
