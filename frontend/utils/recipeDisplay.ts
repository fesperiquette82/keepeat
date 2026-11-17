// Ce que les écrans affichent d'une recette : durée, ingrédients disponibles
// ou manquants, type de plat. Une valeur inconnue ne s'affiche pas : aucune
// durée par défaut, aucun compteur à zéro par défaut (BUG-101).

type RecipeLike = object | null | undefined;

function fields(recipe: object): Record<string, unknown> {
  return recipe as Record<string, unknown>;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function listLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

/** Durée totale en minutes : celle de l'API (`duration_min`), sinon préparation
 *  + cuisson, sinon l'ancien champ `timeMinutes`. null si elle est inconnue. */
export function resolveRecipeDurationMinutes(recipe: RecipeLike): number | null {
  if (!recipe) return null;
  const values = fields(recipe);
  const served = positiveNumber(values.duration_min);
  if (served !== null) return served;
  const prepAndCook = (positiveNumber(values.prep_time_min) ?? 0) + (positiveNumber(values.cook_time_min) ?? 0);
  if (prepAndCook > 0) return prepAndCook;
  return positiveNumber(values.timeMinutes);
}

/** « 30 min », ou null quand la durée est inconnue. */
export function formatRecipeDuration(minutes: number | null): string | null {
  return minutes !== null && minutes > 0 ? `${minutes} min` : null;
}

/** Ingrédients disponibles et manquants : les compteurs du serveur, sinon la
 *  taille des listes d'ingrédients de la recette. */
export function resolveRecipeIngredientCounts(recipe: RecipeLike): { available: number; missing: number } {
  if (!recipe) return { available: 0, missing: 0 };
  const values = fields(recipe);
  const available = countOrNull(values.available_count)
    ?? countOrNull(values.availableCount)
    ?? listLength(values.available_ingredients)
    ?? listLength(values.usedIngredients)
    ?? 0;
  const missing = countOrNull(values.missing_count)
    ?? countOrNull(values.missingCount)
    ?? listLength(values.missing_ingredients)
    ?? listLength(values.missedIngredients)
    ?? 0;
  return { available, missing };
}

const DEFAULT_TYPE_LABEL = 'Idée simple';

// Codes servis par l'API (premier `meal_type` du catalogue, « plat » par défaut)
// et anciens types du moteur de démonstration.
const TYPE_LABELS: Record<string, string> = {
  breakfast: 'Petit-déjeuner',
  lunch: 'Déjeuner',
  dinner: 'Dîner',
  snack: 'En-cas',
  dessert: 'Dessert',
  aperitif: 'Apéritif',
  plat: 'Plat',
  apero: 'Apéro',
  toast: 'Toast',
  tartine: 'Tartine',
  poelee: 'Poêlée',
  salade: 'Salade',
  bol: 'Bol',
  rapide: 'Rapide',
};

/** Libellé du type de plat. Les recettes générées portent un libellé libre
 *  (« Recette simple ») : il est affiché tel quel s'il est court. */
export function recipeTypeLabel(dishType: unknown): string {
  if (typeof dishType !== 'string') return DEFAULT_TYPE_LABEL;
  const raw = dishType.trim();
  if (!raw) return DEFAULT_TYPE_LABEL;
  const key = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const known = TYPE_LABELS[key];
  if (known) return known;
  return raw.length <= 30 ? raw.charAt(0).toUpperCase() + raw.slice(1) : DEFAULT_TYPE_LABEL;
}

/** Assemble une ligne d'informations en ignorant ce qui est inconnu. */
export function joinRecipeMeta(parts: (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ');
}
