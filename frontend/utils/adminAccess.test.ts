import assert from 'node:assert/strict';
import test from 'node:test';

import { isAdminUser } from './adminAccess';

test('isAdminUser retourne false sans user', () => {
  assert.equal(isAdminUser(null), false);
});
