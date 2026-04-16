import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwipeAction } from './stockSwipe';

test('resolveSwipeAction mappe correctement le swipe gauche vers used', () => {
  assert.equal(resolveSwipeAction('left'), 'used');
});

test('resolveSwipeAction mappe correctement le swipe droit vers thrown', () => {
  assert.equal(resolveSwipeAction('right'), 'thrown');
});
