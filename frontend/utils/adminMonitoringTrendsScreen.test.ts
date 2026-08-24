import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// L'endpoint backend /admin/monitoring/trends existait sans aucune page
// frontend qui l'appelle — ces tests vérifient que la page dédiée existe
// bien, appelle le bon endpoint, et est reliée depuis la navigation admin.
// ---------------------------------------------------------------------------

test('adminMonitoringApi.ts expose getMonitoringTrends et getMonitoringApiDrill', () => {
  const src = readSource('utils/adminMonitoringApi.ts');
  assert.match(src, /\/api\/admin\/monitoring\/trends/);
  assert.match(src, /\/api\/admin\/monitoring\/api-drill/);
  assert.match(src, /export async function getMonitoringApiDrill/);
});

test("l'écran trends.tsx existe et consomme getMonitoringTrends", () => {
  const src = readSource('app/admin/monitoring/trends.tsx');
  assert.match(src, /getMonitoringTrends/);
  assert.match(src, /data\.dau/);
  assert.match(src, /data\.new_users/);
  assert.match(src, /data\.errors/);
  assert.match(src, /data\.costs/);
});

test('AdminMonitoringNav pointe vers /admin/monitoring/trends', () => {
  const src = readSource('component/admin/AdminMonitoringNav.tsx');
  assert.match(src, /\/admin\/monitoring\/trends/);
});

test('apis.tsx propose un détail par endpoint via getMonitoringApiDrill', () => {
  const src = readSource('app/admin/monitoring/apis.tsx');
  assert.match(src, /getMonitoringApiDrill/);
  assert.match(src, /by_status/);
});
