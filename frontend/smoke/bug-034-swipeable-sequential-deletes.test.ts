import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { createSwipeActionQueue } from '../utils/stockSwipe';

/**
 * BUG-034 — Smoke test : suppressions séquentielles par swipe.
 *
 * Exerce le VRAI module `createSwipeActionQueue` (utilisé par stock.tsx) plutôt qu'un mock
 * inline. Vérifie que N suppressions enchaînées s'exécutent toutes, dans l'ordre, sans
 * qu'une tâche n'en bloque une autre — l'invariant cassé par BUG-034 côté orchestration JS.
 *
 * La couverture du blocage GESTUEL natif est dans .maestro/14-stock-swipe-delete-consecutive.yaml.
 */
describe('BUG-034 smoke: les suppressions séquentielles s’exécutent toutes', () => {
  it('exécute 5 suppressions consécutives, dans l’ordre, sans en bloquer une', async () => {
    const queue = createSwipeActionQueue();
    const done: number[] = [];

    const tasks = [1, 2, 3, 4, 5].map((i) =>
      queue.enqueue(async () => {
        await Promise.resolve();
        done.push(i);
        return i;
      }),
    );

    const results = await Promise.all(tasks);

    assert.deepStrictEqual(results, [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(done, [1, 2, 3, 4, 5], 'Les 5 suppressions doivent aboutir dans l’ordre');
  });
});
