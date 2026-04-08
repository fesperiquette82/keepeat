"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSuggestionRecipe = normalizeSuggestionRecipe;
exports.applyFrontRecipeSafetyGuardrail = applyFrontRecipeSafetyGuardrail;
exports.applyFrontRecipeSafetyGuardrailWithStyle = applyFrontRecipeSafetyGuardrailWithStyle;
const MIN_MATCHED_INGREDIENTS = 2;
const MIN_RELEVANCE_SCORE = 0.45;
const EXOTIC_MARKERS = ['thai', 'curry', 'wok', 'sushi', 'ramen', 'tacos', 'kimchi', 'masala'];
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    return undefined;
}
function normalizeSuggestionRecipe(raw, index) {
    const debugObject = (raw?.debug && typeof raw.debug === 'object') ? raw.debug : undefined;
    const debugFallback = typeof debugObject?.is_fallback === 'boolean' ? debugObject.is_fallback : false;
    const countryFromMeta = raw?.country ?? raw?.origin_country ?? raw?.locale_country;
    const countryFromDebug = debugObject?.country ?? debugObject?.origin_country;
    return {
        id: raw?.id ?? `recipe-${index}`,
        title: String(raw?.title ?? '').trim(),
        image: String(raw?.image ?? ''),
        usedIngredients: asStringArray(raw?.usedIngredients ?? raw?.used_ingredients ?? raw?.matchedIngredients ?? raw?.matched_ingredients),
        missedIngredients: asStringArray(raw?.missedIngredients ?? raw?.missingIngredients ?? raw?.missing_ingredients),
        sourceUrl: String(raw?.sourceUrl ?? raw?.source_url ?? ''),
        is_fallback: Boolean(raw?.is_fallback) || debugFallback,
        is_ai: Boolean(raw?.is_ai),
        ingredients_used: asStringArray(raw?.ingredients_used),
        instructions_summary: String(raw?.instructions_summary ?? ''),
        prep_time_min: asNumber(raw?.prep_time_min),
        score: asNumber(raw?.score),
        cuisine: typeof raw?.cuisine === 'string' ? raw.cuisine : undefined,
        country: typeof countryFromMeta === 'string' ? countryFromMeta : (typeof countryFromDebug === 'string' ? countryFromDebug : undefined),
        fallback_reason: typeof raw?.fallback_reason === 'string' ? raw.fallback_reason : (typeof debugObject?.fallback_reason === 'string' ? String(debugObject.fallback_reason) : undefined),
        debug: debugObject,
    };
}
function computeFinalScore(recipe) {
    const fromDebug = asNumber(recipe.debug?.final_score);
    if (fromDebug !== undefined)
        return fromDebug;
    if (recipe.score !== undefined)
        return recipe.score;
    const matched = recipe.usedIngredients.length;
    const missing = recipe.missedIngredients.length;
    if (matched + missing === 0)
        return null;
    return matched / (matched + missing);
}
function applyFrontRecipeSafetyGuardrail(recipes) {
    const kept = [];
    const filtered = [];
    for (const recipe of recipes) {
        const matched = recipe.usedIngredients.length;
        const missing = recipe.missedIngredients.length;
        const finalScore = computeFinalScore(recipe);
        if (matched < MIN_MATCHED_INGREDIENTS) {
            filtered.push({ recipeId: recipe.id, title: recipe.title, reason: 'matched_ingredients_below_threshold' });
            continue;
        }
        if (finalScore === null) {
            filtered.push({ recipeId: recipe.id, title: recipe.title, reason: 'missing_score_fields_conservative_fallback' });
            continue;
        }
        if (finalScore < MIN_RELEVANCE_SCORE) {
            filtered.push({ recipeId: recipe.id, title: recipe.title, reason: 'final_score_below_threshold' });
            continue;
        }
        if (missing > matched + 1) {
            filtered.push({ recipeId: recipe.id, title: recipe.title, reason: 'too_many_missing_ingredients' });
            continue;
        }
        kept.push(recipe);
    }
    return { kept, filtered };
}
function applyFrontRecipeSafetyGuardrailWithStyle(recipes, style) {
    const base = applyFrontRecipeSafetyGuardrail(recipes);
    if (style !== 'classique')
        return base;
    const familiarCandidates = base.kept.filter((recipe) => {
        const haystack = `${recipe.title} ${recipe.cuisine ?? ''} ${(recipe.debug?.familiarity_reason ?? '')}`.toLowerCase();
        return !EXOTIC_MARKERS.some((marker) => haystack.includes(marker));
    });
    if (familiarCandidates.length > 0) {
        const familiarIds = new Set(familiarCandidates.map((recipe) => recipe.id));
        const additionallyFiltered = base.kept
            .filter((recipe) => !familiarIds.has(recipe.id))
            .map((recipe) => ({
            recipeId: recipe.id,
            title: recipe.title,
            reason: 'classique_mode_exotic_guardrail',
        }));
        return {
            kept: familiarCandidates,
            filtered: [...base.filtered, ...additionallyFiltered],
        };
    }
    return base;
}
