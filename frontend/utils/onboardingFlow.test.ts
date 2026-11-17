import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-043 — audit commercial, point 10 (angle mort activation) : aucun
// parcours d'accueil n'existait, le nouvel inscrit atterrissait directement
// sur un tableau de bord vide. Verrouillage par lecture de source (comme
// networkTimeouts.test.ts) : app/onboarding.tsx, app/verify-email.tsx et
// app/index.tsx ne sont pas importables directement dans ces tests
// (react-native / expo-router sont des modules natifs).
// ---------------------------------------------------------------------------

test("verify-email.tsx redirige vers '/' une fois le compte vérifié (au lieu de rester bloqué sur l'écran de succès)", () => {
  const src = readSource('app/verify-email.tsx');
  const effectStart = src.indexOf("if (status !== 'success') return;");
  assert.ok(effectStart >= 0, "effet de redirection post-succès introuvable");
  const effectSlice = src.slice(effectStart, effectStart + 200);
  assert.match(effectSlice, /router\.replace\('\/'\)/);
});

test("index.tsx décide de la destination post-connexion via decidePostLoginDestination (onboarding vs tabs)", () => {
  const src = readSource('app/index.tsx');
  assert.match(src, /import \{ decidePostLoginDestination \} from '\.\.\/utils\/postLoginDestination';/);
  assert.match(src, /import \{ hasSeenOnboarding, markOnboardingSeen \} from '\.\.\/utils\/onboardingStorage';/);
  assert.match(src, /await decidePostLoginDestination\(\{\s*hasSeenOnboarding:\s*seen,/);
  // BUG-095 : le stock du serveur est consulté avant d'imposer l'onboarding.
  assert.match(src, /loadRemoteStock:\s*\(\)\s*=>\s*useStockStore\.getState\(\)\.fetchStock\(/);
});

test('onboarding.tsx existe et propose scan produit / scan ticket / passer', () => {
  const src = readSource('app/onboarding.tsx');
  assert.match(src, /proceed\('\/scan'\)/);
  assert.match(src, /proceed\('\/scan-receipt'\)/);
  assert.match(src, /proceed\('\/\(tabs\)'\)/);
  assert.match(src, /markOnboardingSeen/);
});
