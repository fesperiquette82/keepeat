import { daysUntil } from '../data/mockDashboardData';
import type { DashboardStockItem } from '../data/mockDashboardData';
import { dedupeRecipesById } from './recipesScoping';
import { isClearIngredientMatch, normalizeIngredientName } from './ingredientMatching';

const NOISE_TOKENS = new Set([
  'de', 'des', 'du', 'la', 'le', 'les', 'd', 'au', 'aux', 'et',
  'boite', 'bocal', 'sachet', 'pack', 'lot', 'pieces', 'piece',
  'plein', 'air', 'bleu', 'blanc', 'coeur', 'coeur', 'uht',
  'promo', 'offre', 'format', 'maxi', 'familial', 'entiere',
  'demi', 'ecreme', 'ecremee', 'nature', 'bio', 'origine',
]);

const CANONICAL_INGREDIENTS = [
  'oeuf', 'creme', 'tomate', 'yaourt', 'lait', 'riz', 'poulet', 'oignon',
  'ail', 'beurre', 'farine', 'sucre', 'sel', 'poivre', 'pain', 'thon', 'jambon', 'fromage',
];

export interface RecipeCandidate {
  id: string;
  title: string;
  image?: string;
  duration_min?: number;
  timeMinutes?: number;
  available_ingredients?: string[];
  availableIngredients?: string[];
  usedIngredients?: string[];
  used_ingredients?: string[];
  ingredients?: Array<{ name?: string | null }>;
  missing_ingredients?: string[];
  missingIngredients?: string[];
}

export interface StockItemRecipeSections {
  directRecipes: RecipeCandidate[];
  antiWasteRecipes: RecipeCandidate[];
  globalSuggestions: RecipeCandidate[];
}

export function buildRecipeDetailRoute(recipeId: string): { pathname: '/recipes/[id]'; params: { id: string } } {
  return { pathname: '/recipes/[id]', params: { id: recipeId } };
}

function getRecipeIngredientNames(recipe: RecipeCandidate): string[] {
  const ingredientNames = [
    ...(Array.isArray(recipe.available_ingredients) ? recipe.available_ingredients : []),
    ...(Array.isArray(recipe.availableIngredients) ? recipe.availableIngredients : []),
    ...(Array.isArray(recipe.usedIngredients) ? recipe.usedIngredients : []),
    ...(Array.isArray(recipe.used_ingredients) ? recipe.used_ingredients : []),
    ...(Array.isArray(recipe.missing_ingredients) ? recipe.missing_ingredients : []),
    ...(Array.isArray(recipe.missingIngredients) ? recipe.missingIngredients : []),
    ...(Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((ingredient) => String(ingredient?.name ?? '')).filter(Boolean)
      : []),
  ];

  return Array.from(new Set(ingredientNames.map((name) => String(name).trim()).filter(Boolean)));
}

function recipeDuration(recipe: RecipeCandidate): number {
  if (typeof recipe.duration_min === 'number' && Number.isFinite(recipe.duration_min)) return recipe.duration_min;
  if (typeof recipe.timeMinutes === 'number' && Number.isFinite(recipe.timeMinutes)) return recipe.timeMinutes;
  return 30;
}

function isDirectMatch(itemName: string, recipe: RecipeCandidate): boolean {
  const ingredientNames = getRecipeIngredientNames(recipe);
  return ingredientNames.some((ingredientName) => isClearIngredientMatch(itemName, ingredientName));
}

function countAvailableStockIngredients(
  recipe: RecipeCandidate,
  stockItems: DashboardStockItem[],
): { matchedCount: number; usesOtherUrgentCount: number } {
  const ingredientNames = getRecipeIngredientNames(recipe);
  if (ingredientNames.length === 0 || stockItems.length === 0) return { matchedCount: 0, usesOtherUrgentCount: 0 };

  const matchedItemIds = new Set<string>();
  let usesOtherUrgentCount = 0;

  for (const stockItem of stockItems) {
    if (stockItem.status !== 'active') continue;
    const matchesRecipe = ingredientNames.some((ingredientName) => isClearIngredientMatch(stockItem.name, ingredientName));
    if (!matchesRecipe) continue;

    matchedItemIds.add(stockItem.id);

    const expiryDays = daysUntil(stockItem.expiry_date);
    if (expiryDays !== null && expiryDays <= 2) {
      usesOtherUrgentCount += 1;
    }
  }

  return { matchedCount: matchedItemIds.size, usesOtherUrgentCount };
}

export function normalizeStockItemNameForRecipeMatching(itemName: string): string {
  const normalized = normalizeIngredientName(itemName);
  if (!normalized) return '';

  const withoutPackaging = normalized
    .split(' ')
    .filter((token) => token.length >= 2)
    .filter((token) => !NOISE_TOKENS.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/^\d+[x]\d+$/.test(token))
    .filter((token) => !/^\d+(g|kg|mg|l|cl|ml)$/.test(token))
    .filter((token) => !/^\d+%[a-z]*$/.test(token))
    .join(' ')
    .trim();

  const candidateSource = withoutPackaging || normalized;

  const canonical = CANONICAL_INGREDIENTS.find((ingredient) => isClearIngredientMatch(candidateSource, ingredient));
  if (canonical) return canonical;

  const firstToken = candidateSource.split(' ').find((token) => token.length >= 3);
  return firstToken ?? candidateSource;
}

export function buildStockItemRecipeSections(
  item: DashboardStockItem,
  allStockItems: DashboardStockItem[],
  recipes: RecipeCandidate[],
): StockItemRecipeSections {
  const activeStock = allStockItems.filter((stockItem) => stockItem.status === 'active');
  const uniqueRecipes = dedupeRecipesById(recipes);
  const directRecipes = uniqueRecipes.filter((recipe) =>
    isDirectMatch(item.name, recipe) || isDirectMatch(normalizeStockItemNameForRecipeMatching(item.name), recipe),
  );

  const itemExpiryDays = daysUntil(item.expiry_date);
  const itemIsUrgent = itemExpiryDays !== null && itemExpiryDays <= 2;

  const scoredRecipes = uniqueRecipes
    .map((recipe) => {
      const direct = directRecipes.some((directRecipe) => directRecipe.id === recipe.id);
      const { matchedCount, usesOtherUrgentCount } = countAvailableStockIngredients(
        recipe,
        activeStock.filter((stockItem) => stockItem.id !== item.id),
      );
      const duration = recipeDuration(recipe);
      const score =
        (itemIsUrgent ? 1000 : 0) +
        (direct ? 500 : 0) +
        usesOtherUrgentCount * 100 +
        matchedCount * 10 -
        duration * 0.1;

      return {
        recipe,
        score,
        direct,
        usesOtherUrgentCount,
        matchedCount,
      };
    })
    .filter((entry) => entry.direct || entry.usesOtherUrgentCount > 0 || entry.matchedCount >= 2)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return recipeDuration(a.recipe) - recipeDuration(b.recipe);
    });

  const antiWasteRecipes = scoredRecipes
    .filter((entry) => entry.direct)
    .map((entry) => entry.recipe);

  const globalSuggestions = scoredRecipes
    .filter((entry) => !entry.direct)
    .map((entry) => entry.recipe);

  return {
    directRecipes,
    antiWasteRecipes,
    globalSuggestions,
  };
}
