import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-042 — le paywall lisait le prix via getAvailablePurchases(), qui renvoie
// l'historique d'achats de l'utilisateur, pas le catalogue du store : pour
// quiconque n'a jamais acheté, la liste est vide et le prix retombe sur le
// libellé de repli '...'. iapService.ts ne peut pas être importé directement
// dans ces tests (react-native-iap est un module natif, comme react-native /
// expo-constants — cf. crashReporting.ts) : verrouillage par lecture de source,
// même convention que networkTimeouts.test.ts.
// ---------------------------------------------------------------------------

test('loadSubscription() lit le catalogue via fetchProducts({ type: "subs" }), pas getAvailablePurchases()', () => {
  const src = readSource('utils/iapService.ts');
  const fnStart = src.indexOf('export async function loadSubscription');
  assert.ok(fnStart >= 0, 'loadSubscription introuvable dans iapService.ts');
  const fnEnd = src.indexOf('\n}', fnStart);
  const fnBody = src.slice(fnStart, fnEnd);

  assert.match(fnBody, /fetchProducts\(\s*\{\s*skus:\s*SKUS,\s*type:\s*'subs'\s*\}\s*\)/);
});

test("getFormattedPrice() lit displayPrice (ProductSubscription), pas l'ancienne API subscriptionOfferDetails/localizedPrice", () => {
  const src = readSource('utils/iapService.ts');
  const fnStart = src.indexOf('export function getFormattedPrice');
  assert.ok(fnStart >= 0, 'getFormattedPrice introuvable dans iapService.ts');
  const fnEnd = src.indexOf('\n}', fnStart);
  const fnBody = src.slice(fnStart, fnEnd);

  assert.match(fnBody, /sub\?\.displayPrice/);
  assert.doesNotMatch(fnBody, /subscriptionOfferDetails/);
  assert.doesNotMatch(fnBody, /localizedPrice/);
});

test('iapService.ts importe fetchProducts et le type ProductSubscription (API react-native-iap v14+)', () => {
  const src = readSource('utils/iapService.ts');
  assert.match(src, /\bfetchProducts\b/);
  assert.match(src, /type ProductSubscription/);
});

test('premium.tsx type son état "product" en ProductSubscription (et non l\'ancien type Subscription)', () => {
  const src = readSource('app/premium.tsx');
  assert.match(src, /useState<ProductSubscription \| null>/);
  assert.match(src, /import type \{ PurchaseError, ProductSubscription \} from 'react-native-iap';/);
});
