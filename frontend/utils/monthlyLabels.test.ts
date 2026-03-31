import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLastSixMonthLabels } from './monthlyLabels';

test('gère correctement le passage décembre -> janvier', () => {
  const labels = generateLastSixMonthLabels(new Date('2026-01-15T00:00:00Z'));

  assert.deepEqual(
    labels.map((item) => item.month),
    ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'],
  );
  assert.deepEqual(
    labels.map((item) => item.label),
    ['AOÛ 25', 'SEP 25', 'OCT 25', 'NOV 25', 'DÉC 25', 'JAN 26'],
  );
});

test('n’est pas impacté par une date de référence en année bissextile', () => {
  const labels = generateLastSixMonthLabels(new Date('2024-02-29T12:00:00Z'));

  assert.deepEqual(
    labels.map((item) => item.month),
    ['2023-09', '2023-10', '2023-11', '2023-12', '2024-01', '2024-02'],
  );
});

test('couvre correctement un changement d’année', () => {
  const labels = generateLastSixMonthLabels(new Date('2025-12-05T00:00:00Z'));

  assert.deepEqual(
    labels.map((item) => item.month),
    ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'],
  );
});

test('garantit l’absence de doublons', () => {
  const labels = generateLastSixMonthLabels(new Date('2026-03-30T08:30:00Z'));
  const uniqueMonths = new Set(labels.map((item) => item.month));

  assert.equal(labels.length, 6);
  assert.equal(uniqueMonths.size, labels.length);
});
