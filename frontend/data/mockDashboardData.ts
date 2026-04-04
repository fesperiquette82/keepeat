import type { StockItem } from '../store/stockStore';

export type StorageZone = 'frigo' | 'placard';

export interface DashboardStockItem extends StockItem {
  storageZone: StorageZone;
}

export interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
  scalable?: boolean;
}

interface BaseMockRecipe {
  id: string;
  title: string;
  timeMinutes: number;
  type: 'apero' | 'toast' | 'tartine' | 'poelee' | 'salade' | 'bol' | 'rapide';
  baseServings: number;
  ingredientsDetailed: RecipeIngredient[];
  optionalBasics?: string[];
  steps: string[];
  image_url?: string;
}

export interface MockRecipe extends BaseMockRecipe {
  missingCount: number;
  matchedCount: number;
  matchRate: number;
  score: number;
  availableIngredients: string[];
  missingIngredients: string[];
  ingredients: string[];
}

export type RecipeSuggestionScope = 'stock' | 'expiryDay' | 'expiryWeek' | 'expiryMonth' | 'expiryYear';
export interface AntiWastePlan {
  recipes: MockRecipe[];
  coveredItemIds: string[];
  coveredCount: number;
}

const TODAY = new Date();

function isoInDays(days: number): string {
  const value = new Date(TODAY);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

export const MOCK_STOCK_ITEMS: DashboardStockItem[] = [
  { id: 'm1', name: 'Yaourt nature', brand: 'Danone', food_category: 'frais', storageZone: 'frigo', quantity: '4 pots', expiry_date: isoInDays(2), added_date: isoInDays(-3), status: 'active', image_url: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm2', name: 'Lait demi-écrémé', brand: 'Lactel', food_category: 'boissons', storageZone: 'frigo', quantity: '1 bouteille', expiry_date: isoInDays(5), added_date: isoInDays(-6), status: 'active', image_url: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm3', name: 'Courgettes', brand: 'Primeur', food_category: 'legumes', storageZone: 'frigo', quantity: '3 pièces', expiry_date: isoInDays(1), added_date: isoInDays(-2), status: 'active', image_url: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm4', name: 'Poulet émincé', brand: 'Fermier', food_category: 'proteines', storageZone: 'frigo', quantity: '450g', expiry_date: isoInDays(0), added_date: isoInDays(-1), status: 'active', image_url: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm5', name: 'Tomates concassées', brand: 'Mutti', food_category: 'epicerie', storageZone: 'placard', quantity: '2 boîtes', expiry_date: isoInDays(45), added_date: isoInDays(-20), status: 'active', image_url: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm6', name: 'Pâtes complètes', brand: 'Barilla', food_category: 'feculents', storageZone: 'placard', quantity: '500g', expiry_date: isoInDays(180), added_date: isoInDays(-15), status: 'active', image_url: 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm7', name: 'Riz basmati', brand: 'Taureau Ailé', food_category: 'feculents', storageZone: 'placard', quantity: '1 kg', expiry_date: isoInDays(260), added_date: isoInDays(-45), status: 'active', image_url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm8', name: 'Pois chiches', brand: 'Bonduelle', food_category: 'epicerie', storageZone: 'placard', quantity: '1 bocal', expiry_date: isoInDays(90), added_date: isoInDays(-12), status: 'active', image_url: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e3?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm9', name: 'Œufs', brand: 'Plein Air', food_category: 'proteines', storageZone: 'frigo', quantity: '6', expiry_date: isoInDays(4), added_date: isoInDays(-4), status: 'active', image_url: 'https://images.unsplash.com/photo-1506976785307-8732e854ad03?auto=format&fit=crop&w=240&h=240&q=60' },
  { id: 'm10', name: 'Huile d’olive', brand: 'Puget', food_category: 'epicerie', storageZone: 'placard', quantity: '1 bouteille', expiry_date: isoInDays(320), added_date: isoInDays(-90), status: 'active', image_url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=240&h=240&q=60' },
];

const MOCK_RECIPES_BASE: BaseMockRecipe[] = [
  {
    id: 'r1',
    title: 'Poêlée courgettes & poulet',
    type: 'poelee',
    timeMinutes: 20,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Courgettes', quantity: 2, unit: 'pièces' },
      { name: 'Poulet émincé', quantity: 300, unit: 'g' },
      { name: 'Huile d’olive', quantity: 1, unit: 'c. à soupe' },
    ],
    optionalBasics: ['Ail', 'Herbes', 'Poivre'],
    steps: [
      'Coupez les courgettes en demi-rondelles et assaisonnez le poulet.',
      'Faites revenir le poulet 5 min dans l’huile chaude.',
      'Ajoutez les courgettes, couvrez 8 à 10 min et mélangez régulièrement.',
      'Rectifiez l’assaisonnement et servez chaud.',
    ],
    image_url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=240&h=240&q=60',
  },
  {
    id: 'r2',
    title: 'Shakshuka express',
    type: 'poelee',
    timeMinutes: 25,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Tomates concassées', quantity: 400, unit: 'g' },
      { name: 'Œufs', quantity: 4, unit: 'pièces' },
      { name: 'Huile d’olive', quantity: 1, unit: 'c. à soupe' },
    ],
    optionalBasics: ['Ail', 'Paprika', 'Pain'],
    steps: [
      'Faites chauffer l’huile et ajoutez l’ail si disponible.',
      'Versez les tomates, salez et laissez réduire 10 min.',
      'Formez 4 puits, cassez les œufs et couvrez 5 min.',
      'Saupoudrez de paprika et servez avec du pain.',
    ],
    image_url: 'https://images.unsplash.com/photo-1590301157890-4810ed352733?auto=format&fit=crop&w=240&h=240&q=60',
  },
  {
    id: 'r3',
    title: 'Salade pois chiches & yaourt',
    type: 'salade',
    timeMinutes: 15,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Pois chiches', quantity: 240, unit: 'g' },
      { name: 'Yaourt nature', quantity: 2, unit: 'pots' },
      { name: 'Tomates concassées', quantity: 150, unit: 'g' },
    ],
    optionalBasics: ['Citron', 'Herbes', 'Huile d’olive'],
    steps: [
      'Rincez les pois chiches puis égouttez-les bien.',
      'Mélangez le yaourt avec un filet de citron et des herbes.',
      'Ajoutez les tomates et les pois chiches.',
      'Répartissez dans des bols et servez frais.',
    ],
    image_url: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=240&h=240&q=60',
  },
  {
    id: 'r4',
    title: 'Pâtes crémeuses au lait',
    type: 'rapide',
    timeMinutes: 18,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Pâtes complètes', quantity: 180, unit: 'g' },
      { name: 'Lait demi-écrémé', quantity: 250, unit: 'ml' },
      { name: 'Courgettes', quantity: 1, unit: 'pièce' },
    ],
    optionalBasics: ['Fromage', 'Poivre'],
    steps: [
      'Faites cuire les pâtes al dente.',
      'Poêlez la courgette en petits dés 5 min.',
      'Ajoutez le lait puis laissez frémir 3 min.',
      'Mélangez avec les pâtes et servez.',
    ],
    image_url: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=240&h=240&q=60',
  },
  {
    id: 'r5',
    title: 'Tartines apéro rillettes & crudités',
    type: 'tartine',
    timeMinutes: 10,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Rillettes de canard', quantity: 120, unit: 'g' },
      { name: 'Pain', quantity: 4, unit: 'tranches' },
      { name: 'Cornichons', quantity: 8, unit: 'pièces' },
    ],
    optionalBasics: ['Beurre', 'Moutarde', 'Herbes'],
    steps: [
      'Faites légèrement griller les tranches de pain.',
      'Tartinez avec les rillettes.',
      'Ajoutez les cornichons tranchés.',
      'Servez immédiatement en apéro.',
    ],
    image_url: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?auto=format&fit=crop&w=240&h=240&q=60',
  },
  {
    id: 'r6',
    title: 'Toasts champignons poêlés',
    type: 'toast',
    timeMinutes: 12,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Champignons de Paris', quantity: 250, unit: 'g' },
      { name: 'Pain', quantity: 4, unit: 'tranches' },
      { name: 'Beurre', quantity: 20, unit: 'g' },
    ],
    optionalBasics: ['Ail', 'Persil', 'Fromage'],
    steps: [
      'Émincez les champignons puis poêlez-les avec le beurre.',
      'Toastez le pain pendant la cuisson.',
      'Répartissez les champignons sur les toasts.',
      'Ajoutez persil ou fromage selon vos goûts.',
    ],
    image_url: 'https://images.unsplash.com/photo-1528736235302-52922df5c122?auto=format&fit=crop&w=240&h=240&q=60',
  },
  {
    id: 'r7',
    title: 'Assiette composée frigo-placard',
    type: 'apero',
    timeMinutes: 8,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Œufs', quantity: 3, unit: 'pièces' },
      { name: 'Pois chiches', quantity: 150, unit: 'g' },
      { name: 'Tomates concassées', quantity: 120, unit: 'g' },
    ],
    optionalBasics: ['Huile d’olive', 'Pain', 'Herbes'],
    steps: [
      'Cuisez les œufs mollets 6 min puis écalez-les.',
      'Mélangez pois chiches et tomates avec un filet d’huile.',
      'Coupez les œufs en deux et dressez les assiettes.',
      'Servez avec du pain si disponible.',
    ],
    image_url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=240&h=240&q=60',
  },
  {
    id: 'r8',
    title: 'Bol rapide riz, œuf & yaourt',
    type: 'bol',
    timeMinutes: 14,
    baseServings: 2,
    ingredientsDetailed: [
      { name: 'Riz basmati', quantity: 160, unit: 'g' },
      { name: 'Œufs', quantity: 2, unit: 'pièces' },
      { name: 'Yaourt nature', quantity: 2, unit: 'pots' },
    ],
    optionalBasics: ['Herbes', 'Huile d’olive'],
    steps: [
      'Cuisez le riz puis égouttez-le.',
      'Pendant ce temps, faites cuire les œufs au plat ou mollets.',
      'Mélangez le yaourt avec herbes et huile.',
      'Assemblez riz, œufs et sauce au yaourt dans un bol.',
    ],
    image_url: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=240&h=240&q=60',
  },
];

export function findRecipeBaseById(recipeId: string): BaseMockRecipe | undefined {
  return MOCK_RECIPES_BASE.find((recipe) => recipe.id === recipeId);
}

export function daysUntil(expiryDate?: string): number | null {
  if (!expiryDate) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setUTCHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / 86400000);
}

export function resolveStockItems(
  items: StockItem[],
  options?: { useMockFallback?: boolean },
): { items: DashboardStockItem[]; isMock: boolean } {
  if (items.length > 0) {
    return {
      isMock: false,
      items: items.map((item) => ({
        ...item,
        storageZone: item.food_category && ['frais', 'proteines', 'legumes', 'boissons'].includes(item.food_category)
          ? 'frigo'
          : 'placard',
      })),
    };
  }

  if (options?.useMockFallback === false) {
    return { items: [], isMock: false };
  }

  return { items: MOCK_STOCK_ITEMS, isMock: true };
}

export function findExpiringSoon(items: DashboardStockItem[], limit = 3): DashboardStockItem[] {
  return [...items]
    .filter((item) => item.expiry_date)
    .sort((a, b) => (daysUntil(a.expiry_date) ?? 999) - (daysUntil(b.expiry_date) ?? 999))
    .slice(0, limit);
}

export function buildRecipeSuggestions(items: DashboardStockItem[]): MockRecipe[] {
  return buildRecipeSuggestionsByScope(items, 'stock');
}

function getActiveItemsByScope(items: DashboardStockItem[], scope: RecipeSuggestionScope): DashboardStockItem[] {
  const activeItems = items.filter((item) => item.status === 'active');
  if (scope === 'stock') return activeItems;

  const maxDaysByScope: Record<Exclude<RecipeSuggestionScope, 'stock'>, number> = {
    expiryDay: 0,
    expiryWeek: 7,
    expiryMonth: 31,
    expiryYear: 366,
  };

  return activeItems.filter((item) => {
    const days = daysUntil(item.expiry_date);
    if (days === null) return false;
    return days >= 0 && days <= maxDaysByScope[scope];
  });
}

function isRecipeIngredientMatched(stockName: string, ingredientName: string): boolean {
  const source = stockName.toLowerCase();
  const target = ingredientName.toLowerCase();
  const ingredientTokens = target.split(/[\s,&'-]+/).filter((token) => token.length >= 4);
  if (source === target || source.includes(target) || target.includes(source)) return true;
  return ingredientTokens.some((token) => source.includes(token));
}

export function buildRecipeSuggestionsByScope(
  items: DashboardStockItem[],
  scope: RecipeSuggestionScope,
): MockRecipe[] {
  const scopedItems = getActiveItemsByScope(items, scope);
  if (scopedItems.length === 0) return [];

  const normalizedNames = scopedItems.map((item) => item.name.toLowerCase());
  const urgentNames = new Set(
    scopedItems
      .filter((item) => {
        const days = daysUntil(item.expiry_date);
        return days !== null && days >= 0 && days <= 2;
      })
      .map((item) => item.name.toLowerCase()),
  );

  const easyTypes = new Set<MockRecipe['type']>(['apero', 'toast', 'tartine', 'poelee', 'salade', 'bol']);
  const isFastRecipe = (minutes: number) => minutes <= 15;

  const scored = MOCK_RECIPES_BASE.map((recipe) => {
    const availableIngredients: string[] = [];
    const missingIngredients: string[] = [];
    const ingredients = recipe.ingredientsDetailed.map((ingredient) => ingredient.name);

    ingredients.forEach((ingredient) => {
      const found = normalizedNames.some((name) => isRecipeIngredientMatched(name, ingredient));

      if (found) availableIngredients.push(ingredient);
      else missingIngredients.push(ingredient);
    });

    const matchedCount = availableIngredients.length;
    const missingCount = missingIngredients.length;
    const matchRate = Math.round((matchedCount / ingredients.length) * 100);

    const urgencyBonus = availableIngredients.some((ingredient) => urgentNames.has(ingredient.toLowerCase())) ? 10 : 0;
    const quickBonus = isFastRecipe(recipe.timeMinutes) ? 12 : recipe.timeMinutes <= 25 ? 6 : 0;
    const typeBonus = easyTypes.has(recipe.type) ? 8 : 0;
    const nearPossibleBonus = missingCount <= 2 ? 12 : missingCount === 3 ? 6 : 0;
    const score = matchedCount * 35 - missingCount * 8 + urgencyBonus + quickBonus + typeBonus + nearPossibleBonus;

    return {
      ...recipe,
      ingredients,
      matchedCount,
      missingCount,
      matchRate,
      score,
      availableIngredients,
      missingIngredients,
    };
  })
    .filter((recipe) => recipe.matchedCount >= 1 || recipe.missingCount <= 2)
    .sort((a, b) => b.score - a.score || b.matchedCount - a.matchedCount || a.missingCount - b.missingCount || a.timeMinutes - b.timeMinutes);

  return scored.slice(0, 8);
}

export function buildAntiWastePlanByScope(
  items: DashboardStockItem[],
  scope: RecipeSuggestionScope,
): AntiWastePlan {
  const activeItems = items.filter((item) => item.status === 'active');
  const scopedItems = getActiveItemsByScope(items, scope);
  if (activeItems.length === 0 || scopedItems.length === 0) {
    return { recipes: [], coveredItemIds: [], coveredCount: 0 };
  }

  const stockSuggestions = buildRecipeSuggestionsByScope(activeItems, 'stock');
  const suggestionById = new Map(stockSuggestions.map((suggestion) => [suggestion.id, suggestion]));
  const urgencyWeightById = new Map<string, number>();
  activeItems.forEach((item) => {
    const days = daysUntil(item.expiry_date);
    if (days !== null && days >= 0 && days <= 1) urgencyWeightById.set(item.id, 120);
    else if (days !== null && days >= 0 && days <= 7) urgencyWeightById.set(item.id, 65);
    else urgencyWeightById.set(item.id, 25);
  });

  const buildCandidate = (recipe: BaseMockRecipe, blockedIds: Set<string>) => {
    const coveredItems = scopedItems.filter((item) => {
      if (blockedIds.has(item.id)) return false;
      return recipe.ingredientsDetailed.some((ingredient) => isRecipeIngredientMatched(item.name, ingredient.name));
    });
    const coveredIds = coveredItems.map((item) => item.id);
    const relevantIngredients = recipe.ingredientsDetailed.filter((ingredient) =>
      scopedItems.some((item) => isRecipeIngredientMatched(item.name, ingredient.name)),
    );
    const missingCount = recipe.ingredientsDetailed.length - relevantIngredients.length;
    const urgencyScore = coveredItems.reduce((sum, item) => sum + (urgencyWeightById.get(item.id) ?? 0), 0);
    const urgencySpreadBonus = Math.min(coveredItems.length, 3) * 12;
    const durationPenalty = recipe.timeMinutes > 25 ? Math.round((recipe.timeMinutes - 25) * 0.6) : 0;
    const score = urgencyScore + urgencySpreadBonus - missingCount * 18 - durationPenalty;
    const suggestion = suggestionById.get(recipe.id);

    return {
      recipeId: recipe.id,
      score,
      coveredIds,
      missingCount,
      suggestion,
    };
  };

  const selected: MockRecipe[] = [];
  const coveredIds = new Set<string>();
  const first = MOCK_RECIPES_BASE
    .map((recipe) => buildCandidate(recipe, coveredIds))
    .filter((candidate) => candidate.coveredIds.length > 0 && candidate.suggestion)
    .sort((a, b) => b.score - a.score || a.missingCount - b.missingCount)[0];

  if (!first || !first.suggestion) {
    return { recipes: [], coveredItemIds: [], coveredCount: 0 };
  }

  selected.push(first.suggestion);
  first.coveredIds.forEach((itemId) => coveredIds.add(itemId));

  const second = MOCK_RECIPES_BASE
    .filter((recipe) => recipe.id !== first.recipeId)
    .map((recipe) => buildCandidate(recipe, coveredIds))
    .filter((candidate) => candidate.coveredIds.length > 0 && candidate.suggestion)
    .sort((a, b) => b.score - a.score || a.missingCount - b.missingCount)[0];

  if (second && second.suggestion && second.coveredIds.length > 0) {
    selected.push(second.suggestion);
    second.coveredIds.forEach((itemId) => coveredIds.add(itemId));
  }

  return { recipes: selected.slice(0, 2), coveredItemIds: [...coveredIds], coveredCount: coveredIds.size };
}
