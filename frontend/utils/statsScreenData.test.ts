import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { canLoadPredictions, loadStatsScreenData } from './statsScreenData';

// BUG-096 : l'onglet Statistiques chargeait statistiques, gamification et
// prédictions avec un seul Promise.all. Pour un utilisateur gratuit, le 403
// PREMIUM_REQUIRED des prédictions faisait tout échouer et ouvrait le paywall.

const monthly = [{ month: '2026-11', consumed: 4, thrown: 1, score: 80, saved_euros: 6 }];
const gamification = { streak_days: 60 };

test('[REGRESSION BUG-096] utilisateur gratuit : statistiques et gamification chargées, sans prédictions', async () => {
  let predictionsCalled = false;
  const result = await loadStatsScreenData({
    fetchMonthly: async () => monthly,
    fetchGamification: async () => gamification,
    fetchPredictions: canLoadPredictions('free', null)
      ? async () => {
          predictionsCalled = true;
          return [];
        }
      : null,
  });
  assert.deepEqual(result, { monthly, gamification, predictionsCount: 0 });
  assert.equal(predictionsCalled, false);
});

test('un refus des prédictions (403 Premium) ne fait plus échouer le chargement', async () => {
  const result = await loadStatsScreenData({
    fetchMonthly: async () => monthly,
    fetchGamification: async () => gamification,
    fetchPredictions: async () => {
      throw Object.assign(new Error('Request failed with status code 403'), {
        response: { status: 403, data: { detail: { code: 'PREMIUM_REQUIRED', feature: 'predictions' } } },
      });
    },
  });
  assert.deepEqual(result, { monthly, gamification, predictionsCount: 0 });
});

test('utilisateur Premium : les prédictions sont comptées', async () => {
  const result = await loadStatsScreenData({
    fetchMonthly: async () => monthly,
    fetchGamification: async () => gamification,
    fetchPredictions: async () => [{ id: 'a' }, { id: 'b' }],
  });
  assert.equal(result.predictionsCount, 2);
});

test('un échec des statistiques mensuelles reste une erreur de chargement', async () => {
  await assert.rejects(
    loadStatsScreenData({
      fetchMonthly: async () => {
        throw new Error('réseau indisponible');
      },
      fetchGamification: async () => gamification,
      fetchPredictions: null,
    }),
    /réseau indisponible/,
  );
});

test('canLoadPredictions suit les droits quand ils sont connus, sinon le plan', () => {
  assert.equal(canLoadPredictions('premium', null), true);
  assert.equal(canLoadPredictions('free', null), false);
  assert.equal(canLoadPredictions('free', { features: { predictions: { allowed: true } } }), true);
  assert.equal(canLoadPredictions('premium', { features: { predictions: { allowed: false } } }), false);
  assert.equal(canLoadPredictions('premium', { features: {} }), true);
});

test('l’onglet Statistiques charge ses données via loadStatsScreenData', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'app/(tabs)/stats.tsx'), 'utf8');
  assert.match(src, /import \{ canLoadPredictions, loadStatsScreenData \} from '\.\.\/\.\.\/utils\/statsScreenData';/);
  assert.match(src, /await loadStatsScreenData\(\{/);
  assert.match(src, /fetchPredictions:\s*canLoadPredictions\(plan, entitlements\)/);
  assert.doesNotMatch(src, /Promise\.all\(\[[\s\S]{0,400}\/api\/predictions/);
});
