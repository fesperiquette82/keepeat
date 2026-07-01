import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildMarkActionRollback } from './stockRollback';

interface Item { id: string; name: string; }
const stats = (over: Partial<Record<string, number>> = {}) => ({
  total_items: 5,
  expiring_soon: 0,
  expired: 0,
  consumed_this_week: 3,
  thrown_this_week: 2,
  ...over,
});

/**
 * E4 — Régression : le rollback d'un markConsumed/markThrown raté écrasait la liste
 * entière avec un snapshot périmé → un item supprimé entre-temps par une opération
 * concurrente réapparaissait (classe BUG-034).
 */
describe('[REGRESSION] E4 — buildMarkActionRollback (rollback ciblé)', () => {
  it('réinsère uniquement l’item concerné, sans ressusciter un item retiré en parallèle', () => {
    const rolledBackItem: Item = { id: 'A', name: 'Lait' };
    // État courant : A retiré (optimiste, à restaurer) ET B retiré par un swipe concurrent.
    const currentItems: Item[] = [{ id: 'C', name: 'Pain' }];
    const result = buildMarkActionRollback<Item, ReturnType<typeof stats>>({
      currentItems,
      currentPriorityItems: [],
      currentStats: stats(),
      rolledBackItem,
      wasPriority: false,
      action: 'consume',
    });
    const ids = result.items.map(i => i.id);
    assert.ok(ids.includes('A'), 'A (l’item rollbacké) doit être réinséré');
    assert.ok(ids.includes('C'), 'C doit rester');
    assert.ok(!ids.includes('B'), 'B (supprimé en parallèle) ne doit PAS réapparaître');
  });

  it('inverse précisément les deltas de stats pour consume', () => {
    const result = buildMarkActionRollback<Item, ReturnType<typeof stats>>({
      currentItems: [],
      currentPriorityItems: [],
      currentStats: stats({ total_items: 4, consumed_this_week: 4 }),
      rolledBackItem: { id: 'A', name: 'Lait' },
      wasPriority: false,
      action: 'consume',
    });
    assert.equal(result.stats.total_items, 5);
    assert.equal(result.stats.consumed_this_week, 3);
  });

  it('inverse précisément les deltas de stats pour throw', () => {
    const result = buildMarkActionRollback<Item, ReturnType<typeof stats>>({
      currentItems: [],
      currentPriorityItems: [],
      currentStats: stats({ total_items: 4, thrown_this_week: 3 }),
      rolledBackItem: { id: 'A', name: 'Lait' },
      wasPriority: false,
      action: 'throw',
    });
    assert.equal(result.stats.total_items, 5);
    assert.equal(result.stats.thrown_this_week, 2);
  });

  it('ne duplique pas l’item s’il est déjà présent dans la liste courante', () => {
    const item: Item = { id: 'A', name: 'Lait' };
    const result = buildMarkActionRollback<Item, ReturnType<typeof stats>>({
      currentItems: [item],
      currentPriorityItems: [],
      currentStats: stats(),
      rolledBackItem: item,
      wasPriority: false,
      action: 'consume',
    });
    assert.equal(result.items.filter(i => i.id === 'A').length, 1);
  });

  it('item introuvable dans le snapshot → état courant inchangé (rien ressuscité)', () => {
    const currentItems: Item[] = [{ id: 'C', name: 'Pain' }];
    const result = buildMarkActionRollback<Item, ReturnType<typeof stats>>({
      currentItems,
      currentPriorityItems: [],
      currentStats: stats(),
      rolledBackItem: undefined,
      wasPriority: false,
      action: 'consume',
    });
    assert.deepEqual(result.items, currentItems);
    assert.equal(result.stats.total_items, 5);
  });

  it('réinsère dans priorityItems uniquement si l’item y était', () => {
    const item: Item = { id: 'A', name: 'Lait' };
    const result = buildMarkActionRollback<Item, ReturnType<typeof stats>>({
      currentItems: [],
      currentPriorityItems: [],
      currentStats: stats(),
      rolledBackItem: item,
      wasPriority: true,
      action: 'consume',
    });
    assert.ok(result.priorityItems.some(i => i.id === 'A'));
  });
});
