import { formatFrenchRecipeText } from './recipeFrenchTypography';

export type IngredientUnit = 'piece' | 'g' | 'kg' | 'ml' | 'cl' | 'l' | 'tsp' | 'tbsp' | 'pinch' | 'pot' | 'jar' | 'can' | 'slice' | 'box';

export interface RecipeIngredient {
  name: string;
  quantity: number | null;
  unit: IngredientUnit | null;
}

export interface IngredientFormatOptions {
  ingredientName?: string;
  fallbackLabel?: string;
}

interface UnitLabels {
  singular: string;
  plural: string;
}

const UNIT_LABELS: Record<IngredientUnit, UnitLabels> = {
  g: { singular: 'g', plural: 'g' },
  kg: { singular: 'kg', plural: 'kg' },
  ml: { singular: 'ml', plural: 'ml' },
  cl: { singular: 'cl', plural: 'cl' },
  l: { singular: 'l', plural: 'l' },
  piece: { singular: 'pièce', plural: 'pièces' },
  tbsp: { singular: 'c. à soupe', plural: 'c. à soupe' },
  tsp: { singular: 'c. à café', plural: 'c. à café' },
  pinch: { singular: 'pincée', plural: 'pincées' },
  box: { singular: 'boîte', plural: 'boîtes' },
  pot: { singular: 'pot', plural: 'pots' },
  jar: { singular: 'bocal', plural: 'bocaux' },
  can: { singular: 'boîte', plural: 'boîtes' },
  slice: { singular: 'tranche', plural: 'tranches' },
};

const INGREDIENT_OVERRIDES: Array<{ keywords: string[]; unit: IngredientUnit; quantityPerServing: number }> = [
  { keywords: ['oeuf', 'œuf'], unit: 'piece', quantityPerServing: 0.5 },
  { keywords: ['riz'], unit: 'g', quantityPerServing: 75 },
  { keywords: ['pâte', 'pates', 'pâtes', 'semoule', 'quinoa'], unit: 'g', quantityPerServing: 80 },
  { keywords: ['farine', 'sucre', 'maizena', 'maïzena', 'amande en poudre', 'cacao'], unit: 'g', quantityPerServing: 30 },
  { keywords: ['crème', 'creme', 'lait', 'bouillon', 'coulis', 'jus'], unit: 'ml', quantityPerServing: 50 },
  { keywords: ['huile', 'vinaigre'], unit: 'tbsp', quantityPerServing: 0.5 },
  { keywords: ['moutarde', 'miel', 'sirop'], unit: 'tsp', quantityPerServing: 0.5 },
  { keywords: ['olive'], unit: 'piece', quantityPerServing: 3 },
  { keywords: ['thon', 'pois chiche', 'haricot', 'maïs', 'mais', 'lentille en conserve'], unit: 'box', quantityPerServing: 0.25 },
  { keywords: ['yaourt', 'pesto', 'sauce tomate', 'coulis tomate'], unit: 'pot', quantityPerServing: 0.25 },
];

function normalizeIngredientName(name: string): string {
  return formatFrenchRecipeText(name).toLowerCase();
}

function roundQuantity(value: number): number {
  if (value >= 10) return Math.round(value);
  return Math.round(value * 2) / 2;
}

function inferIngredientBase(name: string, baseServings: number): RecipeIngredient {
  const normalized = normalizeIngredientName(name);
  const matched = INGREDIENT_OVERRIDES.find((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)));

  if (!matched) {
    return { name: formatFrenchRecipeText(name), quantity: null, unit: null };
  }

  return {
    name: formatFrenchRecipeText(name),
    quantity: roundQuantity(matched.quantityPerServing * baseServings),
    unit: matched.unit,
  };
}


function buildPieceLabel(quantity: number, ingredientName: string): string {
  const normalizedName = normalizeIngredientName(ingredientName);
  if (normalizedName.includes('oeuf') || normalizedName.includes('œuf')) {
    return quantity > 1 ? 'œufs' : 'œuf';
  }
  return quantity > 1 ? 'pièces' : 'pièce';
}

export function scaleIngredients(
  ingredients: RecipeIngredient[],
  selectedServings: number,
  baseServings: number,
): RecipeIngredient[] {
  const safeBaseServings = Math.max(1, baseServings);
  return ingredients.map((ingredient) => {
    if (typeof ingredient.quantity !== 'number') return ingredient;
    const scaled = (ingredient.quantity * selectedServings) / safeBaseServings;
    return { ...ingredient, quantity: roundQuantity(scaled) };
  });
}

export function buildRecipeIngredients(
  ingredientNames: string[],
  baseServings: number,
): RecipeIngredient[] {
  const uniqueNames = Array.from(new Set(ingredientNames.map((item) => item.trim()).filter(Boolean)));
  return uniqueNames.map((name) => inferIngredientBase(name, Math.max(1, baseServings)));
}

export function formatIngredientQuantity(
  ingredient: Pick<RecipeIngredient, 'quantity' | 'unit'>,
  options?: IngredientFormatOptions,
): string {
  if (typeof ingredient.quantity !== 'number' || !ingredient.unit) {
    return options?.fallbackLabel ?? 'Quantité à ajuster';
  }

  const quantity = roundQuantity(ingredient.quantity);
  const quantityLabel = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(1).replace(/\.0$/, '');

  if (ingredient.unit === 'piece' && options?.ingredientName) {
    return `${quantityLabel} ${buildPieceLabel(quantity, options.ingredientName)}`;
  }

  const labels = UNIT_LABELS[ingredient.unit];
  const unitLabel = quantity > 1 ? labels.plural : labels.singular;
  return `${quantityLabel} ${unitLabel}`;
}
