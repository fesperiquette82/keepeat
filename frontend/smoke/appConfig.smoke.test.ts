import assert from 'node:assert/strict';
import test from 'node:test';

import appConfig from '../app.config';

test('smoke frontend: app config charge sans crash et expose les clés critiques', () => {
  const config = appConfig();
  assert.equal(typeof config.name, 'string');
  assert.equal(typeof config.slug, 'string');
  assert.equal(typeof config.version, 'string');
  assert.ok(config.extra && typeof config.extra === 'object');
});
