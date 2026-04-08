"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const recipesSafetyGuardrail_1 = require("./recipesSafetyGuardrail");
(0, node_test_1.default)('normalizeSuggestionRecipe marque fallback via debug.is_fallback', () => {
    const normalized = (0, recipesSafetyGuardrail_1.normalizeSuggestionRecipe)({
        id: 'r-1',
        title: 'Soupe de légumes',
        usedIngredients: ['carotte', 'oignon'],
        missedIngredients: [],
        debug: {
            is_fallback: true,
        },
    }, 0);
    strict_1.default.equal(normalized.is_fallback, true);
});
(0, node_test_1.default)('normalizeSuggestionRecipe garde false sans fallback explicite', () => {
    const normalized = (0, recipesSafetyGuardrail_1.normalizeSuggestionRecipe)({
        id: 'r-2',
        title: 'Salade rapide',
        usedIngredients: ['tomate', 'concombre'],
        missedIngredients: [],
        debug: {
            source: 'guarded-scope',
        },
    }, 0);
    strict_1.default.equal(normalized.is_fallback, false);
});
