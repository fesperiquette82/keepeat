import assert from 'node:assert/strict';
import test from 'node:test';

import { computeReceiptItemExpiry, defaultReceiptZone } from './receiptExpiry';

test('produit OCR sans date explicite calcule une date estimée via règle de catégorie', () => {
  const expiry = computeReceiptItemExpiry({
    name: 'Lait demi-écrémé',
    purchase_date: '2026-04-01',
    shelf_life_fridge: 7,
    shelf_life_pantry: null,
    shelf_life_freezer: null,
  }, 'fridge');

  assert.equal(expiry, '2026-04-08');
});

test('fallback zone: si la zone choisie n’a pas de durée, on utilise une autre durée disponible', () => {
  const expiry = computeReceiptItemExpiry({
    name: 'Riz basmati',
    purchase_date: '2026-04-01',
    shelf_life_fridge: null,
    shelf_life_pantry: 365,
    shelf_life_freezer: null,
  }, 'fridge');

  assert.equal(expiry, '2027-04-01');
});

test('quand Gemini ne renvoie pas de durée explicite mais un fallback existe, la date est calculée', () => {
  const expiry = computeReceiptItemExpiry({
    name: 'Yaourt nature',
    purchase_date: '2026-04-10',
    estimated_expiration_date: null,
    estimated_shelf_life_days: null,
    shelf_life_fridge: 14,
    shelf_life_pantry: null,
    shelf_life_freezer: null,
  }, 'pantry');

  assert.equal(expiry, '2026-04-24');
});

test('utilise la date estimée explicite quand fournie par OCR/Gemini', () => {
  const expiry = computeReceiptItemExpiry({
    name: 'Poulet',
    estimated_expiration_date: '2026-04-15T00:00:00Z',
    shelf_life_fridge: 3,
  }, 'fridge');

  assert.equal(expiry, '2026-04-15');
});

test('zone par défaut cohérente pour réduire les cas sans estimation', () => {
  assert.equal(defaultReceiptZone({ name: 'Pâtes', shelf_life_fridge: null, shelf_life_pantry: 365 }), 'pantry');
});

test('(régression BUG-058/scan-receipt) chaque produit du ticket garde sa propre zone, sans contamination croisée', () => {
  // Ticket mixte : un produit de frigo et des chips (placard) — la zone de
  // l'un ne doit jamais influencer le calcul de l'autre (chaque appel est
  // indépendant, aucun état partagé entre produits).
  const lait = { name: 'Lait demi-écrémé', shelf_life_fridge: 7, shelf_life_pantry: null, shelf_life_freezer: null };
  const chips = { name: 'Chips pomme de terre truffe', shelf_life_fridge: null, shelf_life_pantry: 180, shelf_life_freezer: null };

  assert.equal(defaultReceiptZone(lait), 'fridge');
  assert.equal(defaultReceiptZone(chips), 'pantry');

  const expiryLait = computeReceiptItemExpiry({ ...lait, purchase_date: '2026-04-01' }, defaultReceiptZone(lait));
  const expiryChips = computeReceiptItemExpiry({ ...chips, purchase_date: '2026-04-01' }, defaultReceiptZone(chips));

  assert.equal(expiryLait, '2026-04-08');
  assert.equal(expiryChips, '2026-09-28');
});
