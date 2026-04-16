import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStockItemImageUrl } from './stockItemImage';

test('résout image_url quand le champ snake_case est présent', () => {
  const image = resolveStockItemImageUrl({ image_url: 'https://cdn/img/snake.jpg' });
  assert.equal(image, 'https://cdn/img/snake.jpg');
});

test('résout imageUrl quand le champ camelCase est présent', () => {
  const image = resolveStockItemImageUrl({ imageUrl: 'https://cdn/img/camel.jpg' });
  assert.equal(image, 'https://cdn/img/camel.jpg');
});

test('retourne undefined sans image valide (fallback UI attendu)', () => {
  const image = resolveStockItemImageUrl({ image_url: '   ', imageUrl: '' });
  assert.equal(image, undefined);
});

test('résout image imbriquée dans product.image_url pour compatibilité API', () => {
  const image = resolveStockItemImageUrl({
    product: {
      image_url: 'https://cdn/img/nested.jpg',
    },
  });
  assert.equal(image, 'https://cdn/img/nested.jpg');
});
