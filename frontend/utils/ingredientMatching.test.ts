import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeRecipeIngredientAvailability,
  isClearIngredientMatch,
  matchRecipeIngredientsToStock,
  normalizeIngredientName,
} from './ingredientMatching';

import type { StockItem } from '../store/stockStore';

const ACTIVE = 'active' as const;

function item(id: string, name: string): StockItem {
  return {
    id,
    name,
    status: ACTIVE,
    added_date: '2026-04-01T00:00:00.000Z',
    expiry_date: '2026-04-20T00:00:00.000Z',
    quantity: '1',
  };
}

test('normalizeIngredientName applique la normalisation demandée', () => {
  assert.equal(normalizeIngredientName('  Œufs!!  '), 'oeuf');
  assert.equal(normalizeIngredientName('Crème  fraîche'), 'creme');
  assert.equal(normalizeIngredientName('Passierte   Tomaten'), 'passierte tomaten');
});

test('reconnaît les concepts tomate multilingues (Passierte Tomaten)', () => {
  assert.equal(isClearIngredientMatch('Passierte Tomaten', 'Tomates concassées'), true);
  assert.equal(isClearIngredientMatch('Passierte Tomaten', 'purée de tomate'), true);
  assert.equal(isClearIngredientMatch('Passierte Tomaten', 'tomatoes'), true);
});

test('évite un faux positif tomate sur ketchup', () => {
  assert.equal(isClearIngredientMatch('Ketchup', 'tomates concassées'), false);
});

test('reconnaît oeuf/œufs/egg/eier', () => {
  assert.equal(isClearIngredientMatch('Œufs', 'oeuf'), true);
  assert.equal(isClearIngredientMatch('Eggs', 'œuf'), true);
  assert.equal(isClearIngredientMatch('Eier', 'oeufs'), true);
});

test('matchRecipeIngredientsToStock retourne les ids attendus avec concepts', () => {
  const stock = [item('1', 'Passierte Tomaten'), item('2', 'Eier')];
  const result = matchRecipeIngredientsToStock(stock, ['Tomates concassées', 'œufs']);

  assert.deepEqual(result.matchedIds.sort(), ['1', '2']);
  assert.deepEqual(result.unmatchedIngredients, []);
});

test('computeRecipeIngredientAvailability est cohérent avec le moteur robuste', () => {
  const stock = [item('1', 'Passierte Tomaten'), item('2', 'yaourt nature')];
  const availability = computeRecipeIngredientAvailability(stock, [
    { name: 'tomato puree' },
    { name: 'yogurt' },
    { name: 'garlic' },
  ]);

  assert.deepEqual(availability.availableIngredients, ['tomato puree', 'yogurt']);
  assert.deepEqual(availability.missingIngredients, ['garlic']);
});
