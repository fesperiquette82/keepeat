import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { createSwipeActionQueue, resolveStockRemovalBanner, resolveSwipeActionFromOpenSide } from '../utils/stockSwipe';
import type { StockRemovalResult } from '../utils/stockRemoval';

/**
 * BUG-034 — Régression "le 2ème swipe est bloqué après la 1ère suppression".
 *
 * Ce test exerce le VRAI module de production `createSwipeActionQueue` (celui utilisé par
 * stock.tsx via swipeActionQueueRef) au lieu de réimplémenter la logique dans le test.
 * Il verrouille le séquencement des suppressions au niveau orchestration JS :
 *   - deux suppressions consécutives s'exécutent toutes les deux, dans l'ordre ;
 *   - la file n'est PAS "empoisonnée" si la 1ère tâche échoue — la 2ème s'exécute quand même
 *     (c'était l'hypothèse exacte du blocage du 2ème swipe).
 *
 * NB : le blocage GESTUEL natif (RNGH + overlay banner) ne peut PAS être reproduit sous
 * node:test. Il est couvert au niveau device par .maestro/14-stock-swipe-delete-consecutive.yaml.
 */
describe('[REGRESSION] BUG-034 — suppression consécutive de 2 articles', () => {
  it('exécute deux suppressions enchaînées, dans l’ordre, sans en bloquer une', async () => {
    const queue = createSwipeActionQueue();
    const executionOrder: string[] = [];

    const first = queue.enqueue(async () => {
      executionOrder.push('item-1:start');
      await Promise.resolve();
      executionOrder.push('item-1:done');
      return 'item-1';
    });

    const second = queue.enqueue(async () => {
      executionOrder.push('item-2:start');
      await Promise.resolve();
      executionOrder.push('item-2:done');
      return 'item-2';
    });

    const [r1, r2] = await Promise.all([first, second]);

    assert.strictEqual(r1, 'item-1');
    assert.strictEqual(r2, 'item-2');
    // La 2ème tâche ne démarre qu'après la fin de la 1ère (sérialisation stricte).
    assert.deepStrictEqual(executionOrder, [
      'item-1:start',
      'item-1:done',
      'item-2:start',
      'item-2:done',
    ]);
  });

  it('n’empoisonne pas la file : si la 1ère suppression échoue, la 2ème s’exécute quand même', async () => {
    const queue = createSwipeActionQueue();
    let secondRan = false;

    const first = queue.enqueue(async () => {
      throw new Error('1ère suppression en échec (ex: erreur API)');
    });

    const second = queue.enqueue(async () => {
      secondRan = true;
      return 'item-2';
    });

    // La 1ère rejette, mais ne doit pas casser la chaîne.
    await assert.rejects(first, /1ère suppression en échec/);
    const r2 = await second;

    assert.strictEqual(r2, 'item-2', 'La 2ème suppression doit aboutir malgré l’échec de la 1ère');
    assert.strictEqual(secondRan, true, 'La 2ème tâche doit bien avoir été exécutée');
  });

  it('produit une bannière "Annuler" valide pour chacune des deux suppressions successives', () => {
    const ok = (): StockRemovalResult => ({
      removedItems: [{ id: 'x' } as any],
      notFoundCount: 0,
      failedCount: 0,
    });

    const banner1 = resolveStockRemovalBanner('used', ok());
    const banner2 = resolveStockRemovalBanner('thrown', ok());

    for (const banner of [banner1, banner2]) {
      assert.strictEqual(banner.variant, 'success');
      assert.strictEqual(banner.canUndo, true, 'Chaque suppression réussie doit rester annulable');
    }
    assert.match(banner1.message, /utilisé/i);
    assert.match(banner2.message, /jeté/i);
  });

  it('mappe le sens du swipe vers la bonne action (contrat onSwipeableOpen de ReanimatedSwipeable)', () => {
    // Migration vers ReanimatedSwipeable : le handler unique onSwipeableOpen reçoit
    // SwipeDirection.LEFT/RIGHT (valeurs "left"/"right") et délègue la conversion en
    // action à resolveSwipeActionFromOpenSide. Ce test verrouille ce contrat de câblage
    // (gauche = utilisé, droite = jeté) qui remplace les ex-callbacks Left/RightOpen.
    assert.strictEqual(resolveSwipeActionFromOpenSide('left'), 'used');
    assert.strictEqual(resolveSwipeActionFromOpenSide('right'), 'thrown');
  });
});
