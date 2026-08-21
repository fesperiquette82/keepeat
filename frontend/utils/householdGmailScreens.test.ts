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

// BUG-036 : la politique de confidentialité (page publique backend /privacy-policy)
// existait déjà mais n'était liée depuis aucun écran de l'app — corrigé ici.
test('settings.tsx propose un lien vers la politique de confidentialité', () => {
  const src = readSource('app/settings.tsx');
  assert.match(src, /Linking\.openURL\(buildApiUrl\('\/privacy-policy'\)\)/);
});

// Le contenu de settings.tsx et household.tsx a grossi au fil des sessions (foyer,
// import mail, politique de confidentialité...) au point que le dernier bouton
// passait sous la barre de gestes Android sans aucun moyen de défiler jusqu'à lui.
test('settings.tsx et household.tsx défilent (ScrollView) plutôt qu\'une View fixe', () => {
  for (const path of ['app/settings.tsx', 'app/household.tsx']) {
    const src = readSource(path);
    assert.match(src, /<ScrollView/, `${path} doit utiliser ScrollView pour son contenu`);
  }
});

// « Foyer » désigne deux choses différentes : le réglage local « nombre de
// convives par défaut » (utilisé pour les recettes, sans rapport avec un
// compte) et le vrai foyer partagé (BUG-049, stock/abonnement partagés entre
// comptes). Les deux ne doivent plus partager le même mot, sous peine de
// laisser croire qu'ils sont liés.
test('le réglage local "convives par défaut" ne s\'appelle plus "foyer" (évite la confusion avec le vrai foyer partagé)', () => {
  const languageSrc = readSource('store/languageStore.ts');
  const householdSizeLine = languageSrc.split('\n').find((line) => line.trim().startsWith('householdSize:'));
  assert.ok(householdSizeLine, 'la clé de traduction householdSize doit exister');
  const labels = householdSizeLine!.match(/fr:\s*'([^']*)'|en:\s*'([^']*)'/g) ?? [];
  assert.equal(labels.length, 2, 'la clé doit définir un libellé fr et en');
  for (const label of labels) {
    assert.doesNotMatch(label, /foyer/i, `le libellé ne doit plus contenir "foyer" (${label})`);
    assert.doesNotMatch(label, /household/i, `le libellé ne doit plus contenir "household" (${label})`);
  }

  const recipeDetailSrc = readSource('app/recipes/[id].tsx');
  assert.doesNotMatch(recipeDetailSrc, /Foyer\s*:\s*\{householdSize\}/, 'le hint de portions ne doit plus afficher "Foyer :"');
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
