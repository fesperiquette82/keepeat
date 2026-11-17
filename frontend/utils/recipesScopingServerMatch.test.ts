import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { normalizeIngredientName } from './ingredientMatching';
import { buildScopedRecipesWithDiagnostics, buildTargetIngredientNames, getServerMatchedStockItemIds } from './recipesScoping';
import { sanitizeRecipe } from './recipeSanitizer';

// BUG-102 : l'onglet Recettes masquait les recettes que le serveur venait de
// trouver. Il recomparait les noms d'ingrédients aux noms des produits, avec
// une normalisation qui coupait « es » à tout pluriel (« carottes » →
// « carott ») mais laissait le singulier intact (« carotte »). Constaté le
// 17/11 : stock « Yaourt nature, Carottes, Pâtes », 5 recettes servies,
// 0 affichée, message « je n'arrive pas à vous proposer de recette ».

const STOCK = [
  { id: 'stock-yaourt', name: 'Yaourt nature' },
  { id: 'stock-carottes', name: 'Carottes' },
  { id: 'stock-pates', name: 'Pâtes' },
];

// Forme réelle des suggestions servies pour ce stock : les noms d'ingrédients
// sont normalisés par le serveur, les articles associés sont donnés par id.
function servedRecipe(id: string, title: string, used: { name: string; stockId: string }[], missing: string[]) {
  return {
    id,
    title,
    duration_min: 30,
    available_count: used.length,
    missing_count: missing.length,
    available_ingredients: used.map((ingredient) => ingredient.name),
    missing_ingredients: missing,
    ingredients: [
      ...used.map((ingredient) => ({ name: ingredient.name, optional: false, available: true, matched_stock_item_ids: [ingredient.stockId] })),
      ...missing.map((name) => ({ name, optional: false, available: false, matched_stock_item_ids: [] })),
    ],
  };
}

const SERVED = [
  servedRecipe('fr_puree_carottes', 'Puree de carottes', [{ name: 'carotte', stockId: 'stock-carottes' }], ['beurre']),
  servedRecipe('fr_riz_saute_legumes', 'Riz saute aux legumes', [{ name: 'carotte', stockId: 'stock-carottes' }], ['riz', 'oignon']),
  servedRecipe('fr_tarte_tomate_moutarde', 'Tarte tomate moutarde', [{ name: 'pate', stockId: 'stock-pates' }], ['tomate', 'moutarde']),
].map((recipe, index) => sanitizeRecipe(recipe, index));

test('BUG-102 : un pluriel français se normalise comme son singulier', () => {
  for (const [plural, singular] of [
    ['Carottes', 'carotte'],
    ['Pâtes', 'pâte'],
    ['Courgettes', 'courgette'],
    ['Pommes', 'pomme'],
    ['Tomates', 'tomate'],
    ['Crêpes', 'crêpe'],
    ['Oeufs', 'oeuf'],
    ['Haricots verts', 'haricot vert'],
  ]) {
    assert.equal(normalizeIngredientName(plural), normalizeIngredientName(singular), `${plural} / ${singular}`);
  }
  // Pluriels anglais en « -oes » et « -ies ».
  assert.equal(normalizeIngredientName('tomatoes'), normalizeIngredientName('tomato'));
  assert.equal(normalizeIngredientName('potatoes'), normalizeIngredientName('potato'));
  assert.equal(normalizeIngredientName('berries'), normalizeIngredientName('berry'));
});

test("BUG-102 : l'onglet Recettes affiche les recettes que le serveur a trouvées pour ce stock", () => {
  const targetNames = buildTargetIngredientNames(STOCK);
  const targetIds = new Set(STOCK.map((item) => item.id));
  const { recipes } = buildScopedRecipesWithDiagnostics(SERVED, targetNames, targetIds);
  assert.deepEqual(recipes.map((recipe) => recipe.id), ['fr_puree_carottes', 'fr_riz_saute_legumes', 'fr_tarte_tomate_moutarde']);
});

test('BUG-102 : sans identifiants (ancien appel), la comparaison des noms garde aussi ces recettes', () => {
  const { recipes } = buildScopedRecipesWithDiagnostics(SERVED, buildTargetIngredientNames(STOCK));
  assert.equal(recipes.length, 3);
});

test('les articles associés par le serveur décident, même quand les noms diffèrent entièrement', () => {
  const stock = [{ id: 'stock-1', name: 'Carottes râpées bio 500g' }];
  const recipe = servedRecipe('fr_puree_carottes', 'Puree de carottes', [{ name: 'carotte', stockId: 'stock-1' }], []);
  const { recipes } = buildScopedRecipesWithDiagnostics([recipe], buildTargetIngredientNames(stock), new Set(['stock-1']));
  assert.equal(recipes.length, 1);
});

test('une recette associée seulement à des articles hors du filtre actif reste masquée', () => {
  // Filtre « Ce jour » : seul le yaourt expire aujourd'hui.
  const target = [STOCK[0]];
  const { recipes } = buildScopedRecipesWithDiagnostics(SERVED, buildTargetIngredientNames(target), new Set([STOCK[0].id]));
  assert.deepEqual(recipes, []);
});

test('seuls les ingrédients requis comptent, comme pour les compteurs du serveur', () => {
  const recipe = {
    id: 'r',
    title: 'R',
    ingredients: [
      { name: 'carotte', optional: false, matched_stock_item_ids: ['a'] },
      { name: 'persil', optional: true, matched_stock_item_ids: ['b'] },
      { name: 'sel', optional: false, matched_stock_item_ids: [] },
    ],
  };
  assert.deepEqual(getServerMatchedStockItemIds(recipe), ['a']);
  assert.equal(getServerMatchedStockItemIds({ id: 'x', ingredients: [] }), null);
  assert.equal(getServerMatchedStockItemIds({ id: 'x' }), null);
});

test("BUG-102 : l'écran Recettes passe les identifiants des articles ciblés au filtre", () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'app/(tabs)/recipes.tsx'), 'utf8');
  assert.match(src, /buildScopedRecipesWithDiagnostics\(rawRecipes, targetIngredientNames, targetItemIds\)/);
});
