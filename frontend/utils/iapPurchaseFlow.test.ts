import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-047 — startPurchase() était un stub qui levait systématiquement
// "Not implemented" : aucun utilisateur ne pouvait acheter premium en
// production, quel que soit le calibrage des quotas gratuit/premium.
// iapService.ts ne peut pas être importé directement dans ces tests
// (react-native-iap est un module natif, comme react-native / expo-constants
// — cf. crashReporting.ts) : verrouillage par lecture de source, même
// convention que iapPriceDisplay.test.ts.
// ---------------------------------------------------------------------------

function extractFunctionBody(src: string, marker: string): string {
  const fnStart = src.indexOf(marker);
  assert.ok(fnStart >= 0, `${marker} introuvable`);
  const fnEnd = src.indexOf('\n}', fnStart);
  return src.slice(fnStart, fnEnd);
}

test("startPurchase() n'est plus un stub qui lève 'Not implemented'", () => {
  const src = readSource('utils/iapService.ts');
  assert.doesNotMatch(src, /Not implemented/);
  assert.doesNotMatch(src, /stub implementation/i);
});

test('startPurchase() appelle requestPurchase() avec type "subs" et le offerToken Android', () => {
  const src = readSource('utils/iapService.ts');
  const fnBody = extractFunctionBody(src, 'export async function startPurchase');

  assert.match(fnBody, /requestPurchase\(/);
  assert.match(fnBody, /type:\s*'subs'/);
  assert.match(fnBody, /subscriptionOfferDetailsAndroid/);
  assert.match(fnBody, /offerToken/);
  assert.match(fnBody, /skus:\s*\[product\.id\]/);
});

test('iapService.ts importe requestPurchase depuis react-native-iap', () => {
  const src = readSource('utils/iapService.ts');
  assert.match(src, /import\s*\{[^}]*\brequestPurchase\b[^}]*\}\s*from\s*'react-native-iap'/s);
});

test('premium.tsx passe le produit chargé (pas un simple SKU) à startPurchase()', () => {
  const src = readSource('app/premium.tsx');
  const fnBody = extractFunctionBody(src, 'const handleSubscribe');

  assert.match(fnBody, /startPurchase\(product\)/);
  assert.match(fnBody, /!product/, 'handleSubscribe doit se garder si le produit du store n\'est pas encore chargé');
  assert.doesNotMatch(src, /PREMIUM_SKU/, 'PREMIUM_SKU ne doit plus être importé/utilisé dans premium.tsx (remplacé par le produit chargé)');
});

test('le bouton d\'abonnement de premium.tsx est désactivé tant que le produit du store n\'est pas chargé', () => {
  const src = readSource('app/premium.tsx');
  assert.match(src, /disabled=\{isPurchasing \|\| !product\}/);
});
