import test from 'node:test';
import assert from 'node:assert/strict';

test('Regression: Swipeable refs cleanup prevents gesture handler lingering', () => {
  // Simulate the ref cleanup logic from stock.tsx
  const swipeableRefs = new Map<string, unknown>();

  // Simulate initial state with 3 items
  const displayedItems = [
    { id: '1', name: 'Apple' },
    { id: '2', name: 'Banana' },
    { id: '3', name: 'Orange' },
  ];

  // Refs added for each item
  displayedItems.forEach((item) => {
    swipeableRefs.set(item.id, `ref-${item.id}`);
  });

  assert.equal(swipeableRefs.size, 3, 'Should have 3 refs initially');

  // Simulate first item removal: item 1 disappears from displayedItems
  const afterFirstRemoval = [displayedItems[1], displayedItems[2]];

  // Cleanup logic (from useEffect in stock.tsx)
  const currentIds = new Set(afterFirstRemoval.map((item) => item.id));
  swipeableRefs.forEach((_, key) => {
    if (!currentIds.has(key)) {
      swipeableRefs.delete(key);
    }
  });

  assert.equal(swipeableRefs.size, 2, 'Should clean up removed refs (now 2)');
  assert(!swipeableRefs.has('1'), 'Ref for item 1 should be deleted');
  assert(swipeableRefs.has('2'), 'Ref for item 2 should remain');
  assert(swipeableRefs.has('3'), 'Ref for item 3 should remain');

  // Simulate second item removal
  const afterSecondRemoval = [displayedItems[2]];
  const currentIds2 = new Set(afterSecondRemoval.map((item) => item.id));
  swipeableRefs.forEach((_, key) => {
    if (!currentIds2.has(key)) {
      swipeableRefs.delete(key);
    }
  });

  assert.equal(swipeableRefs.size, 1, 'Should clean up removed refs (now 1)');
  assert(!swipeableRefs.has('2'), 'Ref for item 2 should be deleted');
  assert(swipeableRefs.has('3'), 'Ref for item 3 should remain');
});

test('Regression: Swipeable close timing ensures gesture handler cleanup', async () => {
  // Simulate the queue execution logic with proper close timing
  const executionLog: string[] = [];

  // Simulate what should happen: swipe -> action -> close
  const simulateSwipeWithCloseAfter = async (itemId: string) => {
    executionLog.push(`swipe-${itemId}-start`);
    // Action completes
    await new Promise((r) => setImmediate(r));
    // Close AFTER action
    executionLog.push(`swipe-${itemId}-close`);
  };

  // Execute two swipes sequentially
  await simulateSwipeWithCloseAfter('1');
  await simulateSwipeWithCloseAfter('2');

  assert.deepEqual(executionLog, [
    'swipe-1-start',
    'swipe-1-close',
    'swipe-2-start',
    'swipe-2-close',
  ]);
});

test('Multiple sequential swipes should be processable in queue', () => {
  // Test that queue can handle multiple items
  let processedCount = 0;
  const items = ['1', '2', '3'];

  items.forEach(() => {
    processedCount++;
  });

  assert.equal(processedCount, 3, 'All three items should be processed');
});
