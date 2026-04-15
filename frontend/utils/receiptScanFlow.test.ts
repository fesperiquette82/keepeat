import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReceiptErrorAction } from './receiptScanFlow';

test('erreur réseau/serveur → fallback (image conservée pour envoi manuel)', () => {
  const networkError = new Error('Network Error');
  const action = resolveReceiptErrorAction(networkError);
  assert.equal(action.type, 'fallback');
});

test('erreur HTTP 502 non-premium → fallback', () => {
  const serverError = { response: { status: 502, data: { detail: 'OCR service unavailable' } } };
  const action = resolveReceiptErrorAction(serverError);
  assert.equal(action.type, 'fallback');
});

test('erreur PREMIUM_REQUIRED → premium (paywall)', () => {
  const premiumError = { response: { data: { detail: { code: 'PREMIUM_REQUIRED', feature: 'ocr_receipt' } } } };
  const action = resolveReceiptErrorAction(premiumError);
  assert.equal(action.type, 'premium');
  if (action.type === 'premium') {
    assert.equal(action.detail.code, 'PREMIUM_REQUIRED');
    assert.equal(action.detail.feature, 'ocr_receipt');
  }
});

test('erreur QUOTA_EXCEEDED → premium (paywall)', () => {
  const quotaError = { response: { data: { detail: { code: 'QUOTA_EXCEEDED', feature: 'ocr_receipt', remaining: 0 } } } };
  const action = resolveReceiptErrorAction(quotaError);
  assert.equal(action.type, 'premium');
  if (action.type === 'premium') {
    assert.equal(action.detail.code, 'QUOTA_EXCEEDED');
    assert.equal(action.detail.remaining, 0);
  }
});
