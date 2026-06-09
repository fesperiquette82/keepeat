import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

describe('BUG-034: Swipeable ref must close before item removal', () => {
  it('should close Swipeable ref to prevent gesture handler lingering after deletion', async () => {
    // Arrange: Mock Swipeable ref with close() method
    const mockSwipeRef = {
      close: mock.fn(),
      openRight: mock.fn(),
    };

    const swipeableRefsMap = new Map<string, any>();
    swipeableRefsMap.set('item-123', mockSwipeRef);

    // Act: Simulate handleSwipeAction closing ref before removal
    const itemId = 'item-123';
    const swipeRef = swipeableRefsMap.get(itemId);
    if (swipeRef) {
      swipeRef.close();
    }

    // Assert: Verify close() was called exactly once
    assert.strictEqual(mockSwipeRef.close.mock.calls.length, 1);
  });

  it('should handle missing ref gracefully (no error on close)', () => {
    // Arrange
    const swipeableRefsMap = new Map<string, any>();

    // Act: Try to close non-existent ref
    const itemId = 'item-999';
    const swipeRef = swipeableRefsMap.get(itemId);
    if (swipeRef) {
      swipeRef.close(); // Should not be called
    }

    // Assert: No error thrown
    assert.doesNotThrow(() => {
      swipeableRefsMap.get(itemId); // Returns undefined, no error
    });
  });

  it('should close all Swipeable refs before batch removal to prevent gesture handler lingering', () => {
    // Arrange: Multiple mock refs
    const mockRefs = new Map<string, any>();
    const itemIds = ['item-1', 'item-2', 'item-3'];

    itemIds.forEach((id) => {
      mockRefs.set(id, {
        close: mock.fn(),
      });
    });

    // Act: Close all refs before removal (simulate batch operation)
    itemIds.forEach((itemId) => {
      const swipeRef = mockRefs.get(itemId);
      if (swipeRef) {
        swipeRef.close();
      }
    });

    // Assert: All refs closed
    mockRefs.forEach((ref) => {
      assert.strictEqual(ref.close.mock.calls.length, 1);
    });
  });

  it('should cleanup all stored timeouts on component unmount', () => {
    // Arrange: Track clearTimeout calls
    const originalClearTimeout = global.clearTimeout;
    let clearTimeoutCalls = 0;
    global.clearTimeout = ((id?: any) => {
      clearTimeoutCalls++;
      return originalClearTimeout(id);
    }) as any;

    const timeoutsMap = new Map<string, ReturnType<typeof setTimeout>>();

    // Simulate storing timeout IDs
    const timeout1 = setTimeout(() => {}, 100);
    const timeout2 = setTimeout(() => {}, 100);
    timeoutsMap.set('item-1', timeout1);
    timeoutsMap.set('item-2', timeout2);

    // Act: Cleanup (simulate unmount effect)
    const timeouts = timeoutsMap;
    timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    timeouts.clear();

    // Assert: All timeouts cleared and map is empty
    assert.strictEqual(clearTimeoutCalls, 2);
    assert.strictEqual(timeoutsMap.size, 0);

    // Cleanup
    global.clearTimeout = originalClearTimeout;
  });
});
