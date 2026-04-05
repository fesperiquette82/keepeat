import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAntiWastePlanByScope,
  buildRecipeSuggestionsByScope,
  type DashboardStockItem,
} from './mockDashboardData';

const ACTIVE_STATUS = 'active' as const;

function buildItem(id: string, name: string, expiryDate: string): DashboardStockItem {
  return {
    id,
    name,
    brand: 'Test',
    food_category: 'frais',
    storageZone: 'frigo',
    quantity: '1',
    expiry_date: expiryDate,
    added_date: '2026-03-01T00:00:00.000Z',
    status: ACTIVE_STATUS,
  };
}

test('le scope stock ne propose que des recettes avec au moins un ingrédient disponible et un plan anti-gaspi global unique', () => {
  const items: DashboardStockItem[] = [
    buildItem('a', 'Courgettes', '2026-04-20T00:00:00.000Z'),
    buildItem('b', 'Poulet émincé', '2026-04-08T00:00:00.000Z'),
  ];

  const suggestions = buildRecipeSuggestionsByScope(items, 'stock');
  assert.equal(suggestions.length > 0, true);
  assert.equal(suggestions.every((recipe) => recipe.matchedCount >= 1), true);

  const plan = buildAntiWastePlanByScope(items, 'stock');
  assert.equal(plan.recipes.length, 1);
  assert.equal(plan.coveredCount >= 1, true);
});
