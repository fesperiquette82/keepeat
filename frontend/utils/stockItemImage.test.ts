import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStockItemImageUrl, resolveStockItemImageUrlWithFallback } from './stockItemImage';

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

test('résout image imbriquée depuis productData.imageUrl', () => {
  const image = resolveStockItemImageUrl({
    productData: {
      imageUrl: 'https://cdn/img/nested-camel.jpg',
    },
  });
  assert.equal(image, 'https://cdn/img/nested-camel.jpg');
});

test('convertit les URLs protocol-relative et http vers https', () => {
  const imageHttp = resolveStockItemImageUrl({ image_url: 'http://cdn/img/http.jpg' });
  const imageProtocolRelative = resolveStockItemImageUrl({ image: '//cdn/img/protocol-relative.jpg' });

  assert.equal(imageHttp, 'https://cdn/img/http.jpg');
  assert.equal(imageProtocolRelative, 'https://cdn/img/protocol-relative.jpg');
});

test("préserve l'image existante quand la payload d'édition n'expose plus de champ image", () => {
  const image = resolveStockItemImageUrlWithFallback(
    { id: 'item-1', name: 'Produit édité' },
    { id: 'item-1', image_url: 'https://cdn/img/existing.jpg' },
  );
  assert.equal(image, 'https://cdn/img/existing.jpg');
});
