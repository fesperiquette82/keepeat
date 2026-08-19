import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from './fetchWithTimeout';

test('fetchWithTimeout fournit un AbortSignal au fetch sous-jacent quand aucun n\'est déjà présent', async () => {
  const calls: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  // @ts-expect-error stub minimal pour le test
  globalThis.fetch = async (_input: any, init: RequestInit) => {
    calls.push(init);
    return new Response('ok');
  };
  try {
    await fetchWithTimeout('https://example.com/api');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('fetchWithTimeout respecte un AbortSignal déjà fourni par l\'appelant (ne le remplace pas)', async () => {
  const controller = new AbortController();
  const calls: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  // @ts-expect-error stub minimal pour le test
  globalThis.fetch = async (_input: any, init: RequestInit) => {
    calls.push(init);
    return new Response('ok');
  };
  try {
    await fetchWithTimeout('https://example.com/api', { signal: controller.signal });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].signal, controller.signal);
});

test('fetchWithTimeout annule (abort) la requête après le délai configuré', async () => {
  const originalFetch = globalThis.fetch;
  let sawAbort = false;
  // @ts-expect-error stub minimal pour le test : ne résout jamais tant que le signal n'abandonne pas
  globalThis.fetch = (_input: any, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      sawAbort = true;
      reject(new Error('AbortError'));
    });
  });
  try {
    await assert.rejects(() => fetchWithTimeout('https://example.com/api', undefined, 10));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(sawAbort, true);
});
