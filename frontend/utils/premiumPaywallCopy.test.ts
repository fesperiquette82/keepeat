/**
 * Non-régression BUG-071 — cohérence de l'argumentaire Premium.
 *
 * La copie du paywall était construite à partir des droits **courants** de
 * l'utilisateur : un compte gratuit (8 scans/mois) lisait donc « jusqu'à 8
 * scans par mois » dans la page censée lui vendre Premium (200/mois).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPremiumCopy, PREMIUM_PLAN_MONTHLY_LIMITS } from './premiumPaywallCopy';

const freeEntitlements = {
  plan: 'free',
  is_premium: false,
  features: {
    ocr_receipt: { allowed: true, monthly_limit: 8 },
    ai_recipes: { allowed: true, monthly_limit: 8 },
  },
} as any;

test('[REGRESSION] BUG-071 — l’argumentaire annonce les limites Premium, pas celles du compte', () => {
  const copy = buildPremiumCopy({ entitlements: freeEntitlements, usage: null });
  const allText = copy.benefits.map((b) => b.text).join(' ');

  assert.match(allText, /200/, 'les limites Premium doivent être annoncées');
  assert.doesNotMatch(
    allText,
    /jusqu’à 8 /,
    'les limites du compte gratuit ne doivent pas être présentées comme l’offre Premium',
  );
});

test('les limites annoncées correspondent à celles du backend', () => {
  // Miroir de backend/entitlements.py::PREMIUM_MONTHLY_LIMITS.
  assert.equal(PREMIUM_PLAN_MONTHLY_LIMITS.ocr_receipt, 200);
  assert.equal(PREMIUM_PLAN_MONTHLY_LIMITS.ai_recipes, 200);
});

test('l’argumentaire ne dépend plus de l’état du compte qui le consulte', () => {
  const asFree = buildPremiumCopy({ entitlements: freeEntitlements, usage: null });
  const asPremium = buildPremiumCopy({
    entitlements: {
      plan: 'premium',
      is_premium: true,
      features: {
        ocr_receipt: { allowed: true, monthly_limit: 200 },
        ai_recipes: { allowed: true, monthly_limit: 200 },
      },
    } as any,
    usage: null,
  });

  assert.deepEqual(
    asFree.benefits.map((b) => b.text),
    asPremium.benefits.map((b) => b.text),
  );
});

test('le plan courant reste exposé, séparément de l’offre vendue', () => {
  const copy = buildPremiumCopy({ entitlements: freeEntitlements, usage: null });

  assert.equal(copy.currentPlan, 'free');
  assert.equal(copy.currentOcrLimit, 8);
  assert.equal(copy.currentAiLimit, 8);
});

test('sans droits connus, le plan courant retombe sur "free" sans casser la copie', () => {
  const copy = buildPremiumCopy({ entitlements: null, usage: null });

  assert.equal(copy.currentPlan, 'free');
  assert.equal(copy.currentOcrLimit, null);
  assert.ok(copy.benefits.length > 0);
});

test('le périmètre du quota recettes est explicité', () => {
  // Le serveur regroupe catalogue et génération IA sous le même quota
  // (FEATURE_AI) : le taire laissait croire que seules les recettes IA le
  // consommaient.
  const copy = buildPremiumCopy({ entitlements: null, usage: null });

  assert.match(copy.quotaScopeNote, /catalogue/i);
  assert.match(copy.quotaScopeNote, /IA/);
});
