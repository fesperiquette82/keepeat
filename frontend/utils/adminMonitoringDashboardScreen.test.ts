import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// Le dashboard admin (/admin/monitoring) calcule déjà, côté backend,
// l'entonnoir d'activation (BUG-039), les crashs frontend (BUG-041), le coût
// par utilisateur actif, les flux critiques et le taux de conversion premium
// — mais ne les affichait jamais. Ces tests vérifient que l'écran les
// consomme réellement, pas juste que le backend les calcule.
// ---------------------------------------------------------------------------

const SCREEN_PATH = 'app/admin/monitoring/index.tsx';

test("le dashboard affiche l'entonnoir d'activation", () => {
  const src = readSource(SCREEN_PATH);
  assert.match(src, /activation_funnel/);
  assert.match(src, /rates\.added_product/);
  assert.match(src, /rates\.purchased/);
});

test('le dashboard affiche les flux critiques', () => {
  const src = readSource(SCREEN_PATH);
  assert.match(src, /critical_flows/);
});

test("le dashboard affiche le résumé de l'import de tickets par email (BUG-054)", () => {
  const src = readSource(SCREEN_PATH);
  assert.match(src, /email_import_overview/);
  assert.match(src, /by_outcome/);
});

test('le dashboard affiche les métriques de coût', () => {
  const src = readSource(SCREEN_PATH);
  assert.match(src, /cost_metrics/);
  assert.match(src, /estimated_net_revenue_eur/);
});

test('le dashboard affiche les crashs frontend', () => {
  const src = readSource(SCREEN_PATH);
  assert.match(src, /crash_reports/);
});

test('le dashboard affiche le taux de conversion premium', () => {
  const src = readSource(SCREEN_PATH);
  assert.match(src, /premium_conversion_rate/);
});

test('le dashboard affiche les ventes premium bloquées par une vérification indisponible (BUG-062)', () => {
  // Depuis que le serveur n'accorde plus Premium sans preuve d'achat, une
  // vérification indisponible empêche une vente réelle : elle doit être
  // visible côté admin, et distinguée d'un refus légitime de Google.
  const src = readSource(SCREEN_PATH);
  assert.match(src, /premium_verification_overview/);
  assert.match(src, /unavailable/);
  assert.match(src, /rejected/);
  assert.match(src, /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/);
});
