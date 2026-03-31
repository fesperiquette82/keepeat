import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPeriodParams, getMonitoringHealth } from './adminMonitoringApi';

test('buildPeriodParams crée une fenêtre relative pour 7d', () => {
  const params = buildPeriodParams('7d');
  assert.ok(params.start_date);
  assert.ok(params.end_date);
});

test('buildPeriodParams conserve les dates custom', () => {
  const params = buildPeriodParams('custom', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  assert.equal(params.start_date, '2026-01-01T00:00:00.000Z');
  assert.equal(params.end_date, '2026-01-02T00:00:00.000Z');
});

test('refuse les appels sans token auth', async () => {
  await assert.rejects(() => getMonitoringHealth(''), /AUTH_TOKEN_MISSING/);
});
