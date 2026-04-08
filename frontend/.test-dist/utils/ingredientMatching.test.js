"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const ingredientMatching_1 = require("./ingredientMatching");
const ACTIVE = 'active';
function item(id, name) {
    return {
        id,
        name,
        status: ACTIVE,
        added_date: '2026-04-01T00:00:00.000Z',
        expiry_date: '2026-04-20T00:00:00.000Z',
        quantity: '1',
    };
}
(0, node_test_1.default)('normalizeIngredientName applique la normalisation demandée', () => {
    strict_1.default.equal((0, ingredientMatching_1.normalizeIngredientName)('  Œufs!!  '), 'oeuf');
    strict_1.default.equal((0, ingredientMatching_1.normalizeIngredientName)('Crème  fraîche'), 'creme');
    strict_1.default.equal((0, ingredientMatching_1.normalizeIngredientName)('Passierte   Tomaten'), 'passierte tomaten');
});
(0, node_test_1.default)('reconnaît les concepts tomate multilingues (Passierte Tomaten)', () => {
    strict_1.default.equal((0, ingredientMatching_1.isClearIngredientMatch)('Passierte Tomaten', 'Tomates concassées'), true);
    strict_1.default.equal((0, ingredientMatching_1.isClearIngredientMatch)('Passierte Tomaten', 'purée de tomate'), true);
    strict_1.default.equal((0, ingredientMatching_1.isClearIngredientMatch)('Passierte Tomaten', 'tomatoes'), true);
});
(0, node_test_1.default)('évite un faux positif tomate sur ketchup', () => {
    strict_1.default.equal((0, ingredientMatching_1.isClearIngredientMatch)('Ketchup', 'tomates concassées'), false);
});
(0, node_test_1.default)('reconnaît oeuf/œufs/egg/eier', () => {
    strict_1.default.equal((0, ingredientMatching_1.isClearIngredientMatch)('Œufs', 'oeuf'), true);
    strict_1.default.equal((0, ingredientMatching_1.isClearIngredientMatch)('Eggs', 'œuf'), true);
    strict_1.default.equal((0, ingredientMatching_1.isClearIngredientMatch)('Eier', 'oeufs'), true);
});
(0, node_test_1.default)('matchRecipeIngredientsToStock retourne les ids attendus avec concepts', () => {
    const stock = [item('1', 'Passierte Tomaten'), item('2', 'Eier')];
    const result = (0, ingredientMatching_1.matchRecipeIngredientsToStock)(stock, ['Tomates concassées', 'œufs']);
    strict_1.default.deepEqual(result.matchedIds.sort(), ['1', '2']);
    strict_1.default.deepEqual(result.unmatchedIngredients, []);
});
(0, node_test_1.default)('computeRecipeIngredientAvailability est cohérent avec le moteur robuste', () => {
    const stock = [item('1', 'Passierte Tomaten'), item('2', 'yaourt nature')];
    const availability = (0, ingredientMatching_1.computeRecipeIngredientAvailability)(stock, [
        { name: 'tomato puree' },
        { name: 'yogurt' },
        { name: 'garlic' },
    ]);
    strict_1.default.deepEqual(availability.availableIngredients, ['tomato puree', 'yogurt']);
    strict_1.default.deepEqual(availability.missingIngredients, ['garlic']);
});
