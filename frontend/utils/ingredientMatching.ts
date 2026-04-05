import type { StockItem } from '../store/stockStore';
import { logger } from './logger';

type IngredientConceptKey =
  | 'tomate'
  | 'oeuf'
  | 'yaourt'
  | 'riz'
  | 'huile_olive'
  | 'lait'
  | 'fromage'
  | 'poulet'
  | 'oignon'
  | 'ail'
  | 'pomme_de_terre'
  | 'beurre'
  | 'creme'
  | 'farine'
  | 'sucre'
  | 'sel'
  | 'poivre'
  | 'pain'
  | 'thon'
  | 'jambon';

interface IngredientConceptDefinition {
  aliases: string[];
  excludedAliases?: string[];
}

interface IngredientMatchEvaluation {
  isMatch: boolean;
  score: number;
  reason: string;
  stockRaw: string;
  ingredientRaw: string;
  stockNormalized: string;
  ingredientNormalized: string;
  stockConcept: IngredientConceptKey | null;
  ingredientConcept: IngredientConceptKey | null;
}

const NON_DISTINCTIVE_TOKENS = new Set([
  'de', 'des', 'du', 'la', 'le', 'les', 'd', 'a', 'au', 'aux', 'en', 'and', 'with', 'et',
  'fresh', 'frais', 'fraiche', 'fraiche', 'nature', 'simple', 'bio', 'organic',
]);

const CONCEPT_DEFINITIONS: Record<IngredientConceptKey, IngredientConceptDefinition> = {
  tomate: {
    aliases: [
      'tomate', 'tomates', 'tomate concassee', 'tomates concassees', 'puree de tomate',
      'puree tomate', 'coulis de tomate', 'sauce tomate simple', 'tomato', 'tomatoes',
      'crushed tomato', 'crushed tomatoes', 'tomato puree', 'tomato puree', 'tomato puree',
      'passierte tomaten', 'gehackte tomaten', 'tomaten', 'tomate pelee', 'tomates pelees',
    ],
    excludedAliases: ['ketchup', 'sauce burger tomate', 'bbq tomato sauce'],
  },
  oeuf: { aliases: ['oeuf', 'oeufs', 'œuf', 'œufs', 'egg', 'eggs', 'ei', 'eier'] },
  yaourt: { aliases: ['yaourt', 'yaourts', 'yaourt nature', 'yoghurt', 'yogurt', 'yogourt', 'joghurt'] },
  riz: { aliases: ['riz', 'riz basmati', 'riz blanc', 'rice', 'basmati rice', 'reis'] },
  huile_olive: { aliases: ['huile d olive', 'huile olive', 'olive oil', 'olivenol', 'olivenol', 'olivenöl'] },
  lait: { aliases: ['lait', 'milk', 'milch'] },
  fromage: { aliases: ['fromage', 'fromages', 'cheese', 'kase', 'käse'] },
  poulet: { aliases: ['poulet', 'chicken', 'huhn', 'hahnchen', 'hahnchen', 'hähnchen'] },
  oignon: { aliases: ['oignon', 'oignons', 'onion', 'onions', 'zwiebel', 'zwiebeln'] },
  ail: { aliases: ['ail', 'garlic', 'knoblauch'] },
  pomme_de_terre: { aliases: ['pomme de terre', 'pommes de terre', 'potato', 'potatoes', 'kartoffel', 'kartoffeln'] },
  beurre: { aliases: ['beurre', 'butter', 'buter', 'butter unsalted', 'butter salted'] },
  creme: { aliases: ['creme', 'crème', 'creme fraiche', 'crème fraiche', 'cream', 'sahne'] },
  farine: { aliases: ['farine', 'flour', 'mehl'] },
  sucre: { aliases: ['sucre', 'sugar', 'zucker'] },
  sel: { aliases: ['sel', 'salt', 'salz'] },
  poivre: { aliases: ['poivre', 'pepper', 'pfeffer'] },
  pain: { aliases: ['pain', 'bread', 'brot'] },
  thon: { aliases: ['thon', 'tuna', 'thunfisch'] },
  jambon: { aliases: ['jambon', 'ham', 'schinken'] },
};

function normalizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') || token.endsWith('x')) return token.slice(0, -1);
  return token;
}

function baseNormalize(value: string): string {
  return value
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .replace(/ß/gi, 'ss')
    .replace(/ö/gi, 'o')
    .replace(/ü/gi, 'u')
    .replace(/ä/gi, 'a')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(value: string): string {
  return baseNormalize(value)
    .split(' ')
    .filter(Boolean)
    .map(normalizeToken)
    .filter((token) => !NON_DISTINCTIVE_TOKENS.has(token))
    .join(' ')
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(' ').filter((token) => token.length >= 2));
}

const CONCEPT_ALIAS_TO_KEY = new Map<string, IngredientConceptKey>();
const EXCLUDED_ALIAS_TO_KEY = new Map<string, IngredientConceptKey>();

for (const [key, definition] of Object.entries(CONCEPT_DEFINITIONS) as [IngredientConceptKey, IngredientConceptDefinition][]) {
  for (const alias of definition.aliases) {
    const normalizedAlias = normalizeForComparison(alias);
    if (!normalizedAlias) continue;
    CONCEPT_ALIAS_TO_KEY.set(normalizedAlias, key);
  }
  for (const alias of definition.excludedAliases ?? []) {
    const normalizedAlias = normalizeForComparison(alias);
    if (!normalizedAlias) continue;
    EXCLUDED_ALIAS_TO_KEY.set(normalizedAlias, key);
  }
}

export function normalizeIngredientName(value: string): string {
  return normalizeForComparison(value);
}

function detectIngredientConcept(normalizedName: string): IngredientConceptKey | null {
  if (!normalizedName) return null;
  if (CONCEPT_ALIAS_TO_KEY.has(normalizedName)) {
    return CONCEPT_ALIAS_TO_KEY.get(normalizedName) ?? null;
  }

  let bestConcept: IngredientConceptKey | null = null;
  let bestScore = 0;
  const sourceTokens = tokenSet(normalizedName);

  for (const [alias, concept] of CONCEPT_ALIAS_TO_KEY.entries()) {
    const aliasTokens = tokenSet(alias);
    if (aliasTokens.size === 0) continue;

    let overlap = 0;
    for (const token of aliasTokens) {
      if (sourceTokens.has(token)) overlap += 1;
    }

    if (overlap > 0 && overlap >= Math.ceil(aliasTokens.size * 0.7)) {
      const score = overlap / aliasTokens.size;
      if (score > bestScore) {
        bestScore = score;
        bestConcept = concept;
      }
    }
  }

  return bestConcept;
}

function hasExcludedConceptAlias(normalizedName: string, concept: IngredientConceptKey): boolean {
  for (const [excludedAlias, excludedConcept] of EXCLUDED_ALIAS_TO_KEY.entries()) {
    if (excludedConcept !== concept) continue;
    if (normalizedName === excludedAlias || normalizedName.includes(excludedAlias)) {
      return true;
    }
  }
  return false;
}

function evaluateIngredientStockMatch(stockName: string, ingredientName: string): IngredientMatchEvaluation {
  const stockNormalized = normalizeForComparison(stockName);
  const ingredientNormalized = normalizeForComparison(ingredientName);

  const basePayload = {
    stockRaw: stockName,
    ingredientRaw: ingredientName,
    stockNormalized,
    ingredientNormalized,
  };

  if (!stockNormalized || !ingredientNormalized) {
    return {
      ...basePayload,
      stockConcept: null,
      ingredientConcept: null,
      isMatch: false,
      score: 0,
      reason: 'empty_normalized_value',
    };
  }

  const stockConcept = detectIngredientConcept(stockNormalized);
  const ingredientConcept = detectIngredientConcept(ingredientNormalized);

  if (stockConcept && ingredientConcept) {
    if (stockConcept === ingredientConcept && !hasExcludedConceptAlias(stockNormalized, stockConcept)) {
      return {
        ...basePayload,
        stockConcept,
        ingredientConcept,
        isMatch: true,
        score: 1,
        reason: 'concept_match',
      };
    }

    return {
      ...basePayload,
      stockConcept,
      ingredientConcept,
      isMatch: false,
      score: 0,
      reason: stockConcept !== ingredientConcept ? 'concept_mismatch' : 'concept_excluded_alias',
    };
  }

  if (stockNormalized === ingredientNormalized) {
    return {
      ...basePayload,
      stockConcept,
      ingredientConcept,
      isMatch: true,
      score: 0.95,
      reason: 'normalized_exact_match',
    };
  }

  const stockTokens = tokenSet(stockNormalized);
  const ingredientTokens = [...tokenSet(ingredientNormalized)].filter((token) => token.length >= 3);
  if (ingredientTokens.length === 0) {
    return {
      ...basePayload,
      stockConcept,
      ingredientConcept,
      isMatch: false,
      score: 0,
      reason: 'insufficient_tokens',
    };
  }

  const matchedTokens = ingredientTokens.filter((token) => stockTokens.has(token));
  const ratio = matchedTokens.length / ingredientTokens.length;

  if (ratio >= 0.8 && matchedTokens.length >= 1) {
    return {
      ...basePayload,
      stockConcept,
      ingredientConcept,
      isMatch: true,
      score: ratio,
      reason: 'fallback_token_overlap',
    };
  }

  return {
    ...basePayload,
    stockConcept,
    ingredientConcept,
    isMatch: false,
    score: ratio,
    reason: 'fallback_no_match',
  };
}

export function isClearIngredientMatch(stockName: string, ingredientName: string): boolean {
  return evaluateIngredientStockMatch(stockName, ingredientName).isMatch;
}

function itemRank(item: StockItem): [number, number, string] {
  const expiry = item.expiry_date ? new Date(item.expiry_date).getTime() : Number.POSITIVE_INFINITY;
  const added = item.added_date ? new Date(item.added_date).getTime() : Number.POSITIVE_INFINITY;
  return [expiry, added, item.id];
}

export function matchRecipeIngredientsToStock(
  stockItems: StockItem[],
  ingredientNames: string[],
): { matchedIds: string[]; unmatchedIngredients: string[] } {
  const remaining = [...stockItems];
  const matchedIds: string[] = [];
  const unmatchedIngredients: string[] = [];

  for (const ingredientName of ingredientNames) {
    const candidates = remaining
      .filter((item) => item.status === 'active')
      .map((item) => ({ item, evaluation: evaluateIngredientStockMatch(item.name, ingredientName) }))
      .filter(({ evaluation }) => evaluation.isMatch)
      .sort((a, b) => {
        if (b.evaluation.score !== a.evaluation.score) return b.evaluation.score - a.evaluation.score;
        const rankA = itemRank(a.item);
        const rankB = itemRank(b.item);
        if (rankA[0] !== rankB[0]) return rankA[0] - rankB[0];
        if (rankA[1] !== rankB[1]) return rankA[1] - rankB[1];
        return rankA[2].localeCompare(rankB[2]);
      });

    const picked = candidates[0];
    logger.debug('[RECIPES_MATCH] stock match decision', {
      ingredientRaw: ingredientName,
      candidateCount: candidates.length,
      bestCandidate: picked
        ? {
            id: picked.item.id,
            stockRaw: picked.item.name,
            stockNormalized: picked.evaluation.stockNormalized,
            concept: picked.evaluation.stockConcept,
            score: picked.evaluation.score,
            reason: picked.evaluation.reason,
          }
        : null,
    });

    if (!picked) {
      unmatchedIngredients.push(ingredientName);
      continue;
    }

    matchedIds.push(picked.item.id);
    const idx = remaining.findIndex((item) => item.id === picked.item.id);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  return { matchedIds, unmatchedIngredients };
}

export interface RecipeIngredientAvailabilityInput {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface RecipeIngredientAvailability {
  availableIngredients: string[];
  missingIngredients: string[];
}

export function computeRecipeIngredientAvailability(
  stockItems: StockItem[],
  ingredients: RecipeIngredientAvailabilityInput[],
): RecipeIngredientAvailability {
  const activeStock = stockItems.filter((item) => item.status === 'active');

  const availableIngredients: string[] = [];
  const missingIngredients: string[] = [];

  for (const ingredient of ingredients) {
    const evaluations = activeStock
      .map((stockItem) => ({ stockItem, evaluation: evaluateIngredientStockMatch(stockItem.name, ingredient.name) }))
      .sort((a, b) => b.evaluation.score - a.evaluation.score);

    evaluations.forEach(({ stockItem, evaluation }) => {
      logger.debug('[RECIPES_MATCH] ingredient vs stock diagnostics', {
        ingredientRaw: ingredient.name,
        stockRaw: stockItem.name,
        ingredientNormalized: evaluation.ingredientNormalized,
        stockNormalized: evaluation.stockNormalized,
        ingredientConcept: evaluation.ingredientConcept,
        stockConcept: evaluation.stockConcept,
        score: evaluation.score,
        isMatch: evaluation.isMatch,
        reason: evaluation.reason,
      });
    });

    const matched = evaluations.find(({ evaluation }) => evaluation.isMatch);

    logger.debug('[RECIPES_MATCH] ingredient evaluation', {
      ingredientName: ingredient.name,
      ingredientNormalized: normalizeForComparison(ingredient.name),
      ingredientConcept: evaluations[0]?.evaluation.ingredientConcept ?? null,
      requestedQuantity: ingredient.quantity ?? null,
      requestedUnit: ingredient.unit ?? null,
      matchedStockProduct: matched
        ? {
            id: matched.stockItem.id,
            name: matched.stockItem.name,
            normalizedName: matched.evaluation.stockNormalized,
            concept: matched.evaluation.stockConcept,
            score: matched.evaluation.score,
            reason: matched.evaluation.reason,
          }
        : null,
      reason: matched ? 'robust_match' : 'no_robust_match',
    });

    if (matched) {
      availableIngredients.push(ingredient.name);
    } else {
      missingIngredients.push(ingredient.name);
    }
  }

  return { availableIngredients, missingIngredients };
}
