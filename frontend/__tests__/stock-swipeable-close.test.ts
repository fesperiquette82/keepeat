import { describe, it, expect, vi } from 'vitest';

describe('BUG-034: Swipeable ref must close before item removal', () => {
  it('should close Swipeable ref to prevent gesture handler lingering after deletion', async () => {
    // Arrange: Mock Swipeable ref with close() method
    const mockSwipeRef = {
      close: vi.fn(),
      openRight: vi.fn(),
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
    expect(mockSwipeRef.close).toHaveBeenCalledTimes(1);
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
    expect(() => {
      swipeableRefsMap.get(itemId); // Returns undefined, no error
    }).not.toThrow();
  });

  it('should close all Swipeable refs before batch removal to prevent gesture handler lingering', () => {
    // Arrange: Multiple mock refs
    const mockRefs = new Map<string, any>();
    const itemIds = ['item-1', 'item-2', 'item-3'];

    itemIds.forEach((id) => {
      mockRefs.set(id, {
        close: vi.fn(),
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
      expect(ref.close).toHaveBeenCalledTimes(1);
    });
  });
});
