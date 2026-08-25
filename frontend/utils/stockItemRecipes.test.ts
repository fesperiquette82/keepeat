import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { buildStockItemDetailRecipeBlocks } from './stockItemDetailRecipes';
import type { DashboardStockItem } from '../data/mockDashboardData';
import { buildStockItemRecipeSections, buildRecipeDetailRoute, normalizeStockItemNameForRecipeMatching } from './stockItemRecipes';

function stockItem(overrides: Partial<DashboardStockItem>): DashboardStockItem {
  return {
    id: overrides.id ?? 's1',
    name: overrides.name ?? 'Produit',
    status: 'active',
    added_date: '2026-04-01T00:00:00.000Z',
    expiry_date: overrides.expiry_date ?? '2026-04-20',
    storageZone: 'frigo',
    quantity: '1',
    ...overrides,
  };
}

test('normalise un nom produit avec packaging/marque', () => {
  assert.equal(normalizeStockItemNameForRecipeMatching('Oeufs Plein air Bleu Blanc Coeur - Boite de 10'), 'oeuf');
  assert.equal(normalizeStockItemNameForRecipeMatching('Crème entière UHT 30%MG, 3x20cl'), 'creme');
});

test('retourne des recettes directes quand l’article est référencé', () => {
  const item = stockItem({ id: 'egg', name: 'Oeufs Plein air Bleu Blanc Coeur - Boite de 10', expiry_date: '2026-04-18' });
  const stock = [item, stockItem({ id: 'milk', name: 'Lait', expiry_date: '2026-04-19' })];
  const recipes = [
    { id: 'r1', title: 'Omelette', available_ingredients: ['oeuf', 'lait'], duration_min: 10 },
    { id: 'r2', title: 'Soupe', available_ingredients: ['courgette'], duration_min: 15 },
  ];

  const sections = buildStockItemRecipeSections(item, stock, recipes);
  assert.deepEqual(sections.directRecipes.map((recipe) => recipe.id), ['r1']);
});

test("l'écran détail produit n'affiche pas de bloc de suggestions générales", () => {
  const blocks = buildStockItemDetailRecipeBlocks({
    directRecipes: [],
    antiWasteRecipes: [{ id: 'aw1', title: 'Anti-gaspi lié' }],
    globalSuggestions: [{ id: 'g1', title: 'Suggestion globale' }],
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.title, 'Recettes avec cet ingrédient');
});

test("retourne des suggestions anti-gaspi liées uniquement pour les recettes qui utilisent vraiment l'ingrédient", () => {
  const selected = stockItem({ id: 'cream', name: 'Crème entière UHT 30%MG, 3x20cl', expiry_date: '2026-04-18' });
  const urgentOther = stockItem({ id: 'egg', name: 'Oeufs', expiry_date: '2026-04-18' });
  const stock = [selected, urgentOther, stockItem({ id: 'rice', name: 'Riz basmati', expiry_date: '2026-05-30' })];
  const recipes = [
    { id: 'direct', title: 'Pâtes crème', available_ingredients: ['creme', 'oeuf'], duration_min: 15 },
    { id: 'urgent-other', title: 'Omelette', available_ingredients: ['oeuf'], duration_min: 8 },
    { id: 'off-topic', title: 'Dessert exotique', available_ingredients: ['ananas'], duration_min: 35 },
  ];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.deepEqual(sections.antiWasteRecipes.map((recipe) => recipe.id), ['direct']);
  assert.deepEqual(sections.globalSuggestions.map((recipe) => recipe.id), ['urgent-other']);
});

test('article sans recette liée retourne des sections vides', () => {
  const selected = stockItem({ id: 'jam', name: 'Confiture de fraise', expiry_date: '2026-05-20' });
  const stock = [selected, stockItem({ id: 'rice', name: 'Riz basmati', expiry_date: '2026-07-01' })];
  const recipes = [{ id: 'r1', title: 'Soupe', available_ingredients: ['poireau'], duration_min: 20 }];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.equal(sections.directRecipes.length, 0);
  assert.equal(sections.antiWasteRecipes.length, 0);
  assert.equal(sections.globalSuggestions.length, 0);
});

test('si aucune recette n’est réellement liée, aucune recette non liée n’est injectée dans la section directe', () => {
  const selected = stockItem({ id: 'jam', name: 'Confiture de fraise', expiry_date: '2026-05-20' });
  const stock = [selected, stockItem({ id: 'egg', name: 'Oeufs', expiry_date: '2026-04-18' })];
  const recipes = [
    { id: 'r-omelette', title: 'Omelette', available_ingredients: ['oeuf'], duration_min: 8 },
  ];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.deepEqual(sections.directRecipes.map((recipe) => recipe.id), []);
});

test('supprime les doublons de recettes dans la section des recettes associées', () => {
  const selected = stockItem({ id: 'egg', name: 'Oeufs', expiry_date: '2026-04-18' });
  const stock = [selected];
  const recipes = [
    { id: 'r1', title: 'Omelette', available_ingredients: ['oeuf'], duration_min: 8 },
    { id: 'r1', title: 'Omelette (dup)', available_ingredients: ['oeuf'], duration_min: 8 },
  ];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.deepEqual(sections.directRecipes.map((recipe) => recipe.id), ['r1']);
});

test("l'écran détail produit garde un état vide explicite pour les recettes associées", () => {
  const blocks = buildStockItemDetailRecipeBlocks({
    directRecipes: [],
    antiWasteRecipes: [],
    globalSuggestions: [],
  });

  assert.equal(blocks[0]?.emptyText, 'Aucune recette ne référence directement cet ingrédient.');
});



test('sépare les suggestions globales des recettes réellement liées pour éviter un écran contradictoire', () => {
  const selected = stockItem({ id: 'jam', name: 'Confiture de fraise', expiry_date: '2026-05-20' });
  const urgentEgg = stockItem({ id: 'egg', name: 'Oeufs', expiry_date: '2026-04-18' });
  const stock = [selected, urgentEgg];
  const recipes = [
    { id: 'r-omelette', title: 'Omelette', available_ingredients: ['oeuf'], duration_min: 8 },
  ];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.deepEqual(sections.directRecipes.map((recipe) => recipe.id), []);
  assert.deepEqual(sections.antiWasteRecipes.map((recipe) => recipe.id), []);
  assert.deepEqual(sections.globalSuggestions.map((recipe) => recipe.id), ['r-omelette']);
});

test("(régression perf) le filtre « autres articles actifs » n'est calculé qu'une fois par article, pas une fois par recette candidate", () => {
  // buildStockItemRecipeSections est appelée une fois PAR ARTICLE EN STOCK par
  // buildRecipeAssociationsSnapshot (recipeAssociations.ts), donc toute étape
  // O(nombre d'articles) recalculée à l'intérieur du .map() sur les recettes
  // rend l'ensemble O(articles² × recettes) — synchrone sur le thread JS à chaque
  // fois que l'onglet Recettes reprend le focus (useFocusEffect). Vérifie que le
  // filtre invariant est bien sorti de la boucle plutôt que de tester un
  // comportement observable identique dans les deux cas (voir analyse : cette
  // exclusion ne change jamais la sortie publique de la fonction, seulement son coût).
  const src = fs.readFileSync(path.join(process.cwd(), 'utils/stockItemRecipes.ts'), 'utf8');
  const mapStart = src.indexOf('.map((recipe) => {');
  const filterCall = 'activeStock.filter((stockItem) => stockItem.id !== item.id)';
  const filterIndex = src.indexOf(filterCall);
  assert.ok(filterIndex !== -1, 'le filtre attendu doit exister quelque part dans le fichier');
  assert.ok(filterIndex < mapStart, 'le filtre doit être calculé avant le .map() sur les recettes, pas à l’intérieur');
  assert.ok(!src.slice(mapStart).includes(filterCall), 'le filtre ne doit pas être recalculé à l’intérieur du .map()');
});

test('construit la route de navigation vers le détail recette existant', () => {
  assert.deepEqual(buildRecipeDetailRoute('recipe-42'), {
    pathname: '/recipes/[id]',
    params: { id: 'recipe-42' },
  });
});
