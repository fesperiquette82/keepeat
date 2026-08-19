import test from 'node:test';
import assert from 'node:assert/strict';
import { reportCrash } from './crashReporting';

test('reportCrash envoie un POST /crash-reports avec les champs fournis', async () => {
  const calls: { input: any; init: any }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init: any) => {
    calls.push({ input, init });
    return new Response('{}', { status: 201 });
  };
  try {
    await reportCrash({
      message: 'Boom',
      stack: 'at Component (App.tsx:1:1)',
      screen: '/recipes/42',
      appVersion: '1.2.3',
      platform: 'android',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(String(calls[0].input), /\/crash-reports$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.message, 'Boom');
  assert.equal(body.stack, 'at Component (App.tsx:1:1)');
  assert.equal(body.screen, '/recipes/42');
  assert.equal(body.app_version, '1.2.3');
  assert.equal(body.platform, 'android');
});

test('reportCrash avale silencieusement les erreurs réseau (best-effort)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    await assert.doesNotReject(() => reportCrash({ message: 'Boom' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
