import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePostLoginDestination, resolvePostLoginDestination } from './postLoginDestination';

// BUG-043 (audit commercial, point 10) — un nouvel inscrit atterrissait
// directement sur le tableau de bord (rempli de données de démo mockées),
// sans jamais être guidé vers le geste qui donne de la valeur à l'app
// (ajouter un produit / scanner un ticket).

test('envoie vers /onboarding : jamais vu ET stock vide (nouvel utilisateur)', () => {
  assert.equal(
    resolvePostLoginDestination({ hasSeenOnboarding: false, hasStockItems: false }),
    '/onboarding',
  );
});

test('envoie vers /(tabs) : déjà vu, même avec un stock vide', () => {
  assert.equal(
    resolvePostLoginDestination({ hasSeenOnboarding: true, hasStockItems: false }),
    '/(tabs)',
  );
});

test('envoie vers /(tabs) : jamais vu mais stock déjà rempli (autre appareil / session précédente)', () => {
  assert.equal(
    resolvePostLoginDestination({ hasSeenOnboarding: false, hasStockItems: true }),
    '/(tabs)',
  );
});

test('envoie vers /(tabs) : déjà vu et stock rempli', () => {
  assert.equal(
    resolvePostLoginDestination({ hasSeenOnboarding: true, hasStockItems: true }),
    '/(tabs)',
  );
});

// BUG-095 : la décision ne voyait que le stock local, vide sur un nouvel
// appareil : un utilisateur qui avait déjà des produits sur le serveur
// atterrissait sur l'onboarding.

function stockFixture(initial: number, afterRemote: number) {
  let count = initial;
  let remoteCalls = 0;
  return {
    localStockCount: () => count,
    loadRemoteStock: async () => {
      remoteCalls += 1;
      count = afterRemote;
    },
    remoteCalls: () => remoteCalls,
  };
}

test('[REGRESSION BUG-095] jamais vu, stock local vide mais stock serveur rempli : /(tabs)', async () => {
  const stock = stockFixture(0, 3);
  const destination = await decidePostLoginDestination({ hasSeenOnboarding: false, ...stock });
  assert.equal(destination, '/(tabs)');
  assert.equal(stock.remoteCalls(), 1);
});

test('nouvel utilisateur (stock vide partout) : /onboarding après consultation du serveur', async () => {
  const stock = stockFixture(0, 0);
  assert.equal(await decidePostLoginDestination({ hasSeenOnboarding: false, ...stock }), '/onboarding');
  assert.equal(stock.remoteCalls(), 1);
});

test('onboarding déjà vu ou stock local rempli : aucune requête serveur', async () => {
  const seen = stockFixture(0, 5);
  assert.equal(await decidePostLoginDestination({ hasSeenOnboarding: true, ...seen }), '/(tabs)');
  assert.equal(seen.remoteCalls(), 0);
  const local = stockFixture(2, 2);
  assert.equal(await decidePostLoginDestination({ hasSeenOnboarding: false, ...local }), '/(tabs)');
  assert.equal(local.remoteCalls(), 0);
});

test('serveur en erreur : décision locale, sans lever', async () => {
  const destination = await decidePostLoginDestination({
    hasSeenOnboarding: false,
    localStockCount: () => 0,
    loadRemoteStock: async () => {
      throw new Error('réseau indisponible');
    },
  });
  assert.equal(destination, '/onboarding');
});

test('serveur trop lent : décision locale au bout du délai', async () => {
  const started = Date.now();
  const destination = await decidePostLoginDestination({
    hasSeenOnboarding: false,
    localStockCount: () => 0,
    loadRemoteStock: () => new Promise<void>(() => {}),
    timeoutMs: 50,
  });
  assert.equal(destination, '/onboarding');
  assert.ok(Date.now() - started < 1000);
});
