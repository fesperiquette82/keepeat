import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostLoginDestination } from './postLoginDestination';

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
