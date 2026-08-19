import test from 'node:test';
import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasSeenOnboarding, markOnboardingSeen } from './onboardingStorage';

// BUG-043 (audit commercial, point 10) — le flag "onboarding vu" est stocké
// localement par utilisateur (clé préfixée par userId), pour ne jamais
// remontrer l'écran d'accueil une fois qu'un utilisateur donné l'a traversé.

function mockAsyncStorage() {
  const store = new Map<string, string>();
  (AsyncStorage as any).getItem = async (key: string) => store.get(key) ?? null;
  (AsyncStorage as any).setItem = async (key: string, value: string) => { store.set(key, value); };
  return store;
}

test('hasSeenOnboarding renvoie false pour un utilisateur qui ne l\'a jamais vu', async () => {
  mockAsyncStorage();
  assert.equal(await hasSeenOnboarding('user-a'), false);
});

test('markOnboardingSeen puis hasSeenOnboarding renvoie true, scopé à ce seul utilisateur', async () => {
  mockAsyncStorage();
  await markOnboardingSeen('user-a');
  assert.equal(await hasSeenOnboarding('user-a'), true);
  assert.equal(await hasSeenOnboarding('user-b'), false);
});

test('hasSeenOnboarding renvoie true (best-effort) si la lecture AsyncStorage échoue', async () => {
  (AsyncStorage as any).getItem = async () => { throw new Error('storage unavailable'); };
  assert.equal(await hasSeenOnboarding('user-a'), true);
});

test('markOnboardingSeen ne lève pas si l\'écriture AsyncStorage échoue', async () => {
  (AsyncStorage as any).setItem = async () => { throw new Error('storage unavailable'); };
  await assert.doesNotReject(() => markOnboardingSeen('user-a'));
});
