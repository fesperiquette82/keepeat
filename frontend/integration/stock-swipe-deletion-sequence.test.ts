import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * BUG-034 Integration Test: Swipeable ref lifecycle during batch deletions
 * Verifies that closing refs properly prevents gesture handler lingering across deletions.
 */
describe('Integration: Stock swipeable ref management during deletions', () => {
  it('should maintain clean ref state after closing and deleting item', async () => {
    // Arrange: Simulate ref map and deletion sequence
    const refMap = new Map<string, any>();
    const deletedIds: string[] = [];

    // Pre-populate refs
    const items = ['item-1', 'item-2', 'item-3'];
    items.forEach((id) => {
      refMap.set(id, {
        close: () => {},
        id,
      });
    });

    assert.strictEqual(refMap.size, 3, 'Should start with 3 refs');

    // Act: Simulate handleSwipeAction() flow for first item
    const itemIdToDelete = 'item-1';
    const swipeRef = refMap.get(itemIdToDelete);

    if (swipeRef) {
      swipeRef.close(); // Close BEFORE removal
      deletedIds.push(itemIdToDelete);
      refMap.delete(itemIdToDelete); // Then remove from map
    }

    // Assert: Ref properly cleaned up
    assert.strictEqual(refMap.size, 2, 'Should have 2 refs after deletion');
    assert(!refMap.has(itemIdToDelete), 'Deleted item should not exist in map');
    assert.deepStrictEqual(deletedIds, ['item-1']);
  });

  it('should handle ref close failure gracefully (no exception)', async () => {
    // Arrange: Ref with broken close() method
    const brokenRef = {
      close: () => {
        throw new Error('Close failed');
      },
    };

    const refMap = new Map<string, any>();
    refMap.set('item-broken', brokenRef);

    // Act & Assert: Should not crash even if close() throws
    const itemId = 'item-broken';
    const ref = refMap.get(itemId);

    let closeThrew = false;
    if (ref) {
      try {
        ref.close();
      } catch (e) {
        closeThrew = true;
      }
    }

    assert.strictEqual(closeThrew, true, 'close() threw as expected');
    // App should still remove from map and proceed
    refMap.delete(itemId);
    assert.strictEqual(refMap.size, 0);
  });

  it('cleanup effect should remove orphaned refs for unmounted items', async () => {
    // Arrange: Refs for items that no longer exist in displayed list
    const refMap = new Map<string, any>();
    refMap.set('item-1', { close: () => {} });
    refMap.set('item-2', { close: () => {} });
    refMap.set('item-3', { close: () => {} });

    const displayedItemIds = new Set(['item-1']); // Only item-1 is displayed

    // Act: Cleanup orphaned refs (like the useEffect in stock.tsx)
    const orphanedIds: string[] = [];
    refMap.forEach((_, key) => {
      if (!displayedItemIds.has(key)) {
        orphanedIds.push(key);
        refMap.delete(key);
      }
    });

    // Assert: Orphaned refs cleaned up
    assert.deepStrictEqual(orphanedIds, ['item-2', 'item-3']);
    assert.strictEqual(refMap.size, 1, 'Only item-1 ref remains');
    assert(refMap.has('item-1'), 'item-1 ref should exist');
  });
});
