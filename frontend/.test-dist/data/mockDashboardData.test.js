"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const mockDashboardData_1 = require("./mockDashboardData");
const recipesScoping_1 = require("../utils/recipesScoping");
const ACTIVE_STATUS = 'active';
function buildItem(id, name, expiryDate) {
    return {
        id,
        name,
        brand: 'Test',
        food_category: 'frais',
        storageZone: 'frigo',
        quantity: '1',
        expiry_date: expiryDate,
        added_date: '2026-03-01T00:00:00.000Z',
        status: ACTIVE_STATUS,
    };
}
(0, node_test_1.default)('le scope stock ne propose que des recettes avec au moins un ingrédient disponible et un plan anti-gaspi global unique', () => {
    const items = [
        buildItem('a', 'Courgettes', '2026-04-20T00:00:00.000Z'),
        buildItem('b', 'Poulet émincé', '2026-04-08T00:00:00.000Z'),
    ];
    const suggestions = (0, mockDashboardData_1.buildRecipeSuggestionsByScope)(items, 'stock');
    strict_1.default.equal(suggestions.length > 0, true);
    strict_1.default.equal(suggestions.every((recipe) => recipe.matchedCount >= 1), true);
    const plan = (0, mockDashboardData_1.buildAntiWastePlanByScope)(items, 'stock');
    strict_1.default.equal(plan.recipes.length, 1);
    strict_1.default.equal(plan.coveredCount >= 1, true);
});
(0, node_test_1.default)('daysUntil gère les dates ISO sans dérive timezone (10 avril -> 25/30 avril)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });
    strict_1.default.equal((0, mockDashboardData_1.daysUntil)('2026-04-25'), 15);
    strict_1.default.equal((0, mockDashboardData_1.daysUntil)('2026-04-30'), 20);
    strict_1.default.equal((0, mockDashboardData_1.daysUntil)('2026-04-25T00:00:00.000Z'), 15);
    strict_1.default.equal((0, mockDashboardData_1.daysUntil)('30/04/2026'), null);
});
(0, node_test_1.default)('filtre recettes: expiryMonth inclut 25/30 avril, expiryWeek reste vide au 10 avril', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });
    const items = [
        buildItem('m25', 'Lait', '2026-04-25'),
        buildItem('m30', 'Yaourt', '2026-04-30'),
    ];
    const monthItems = (0, mockDashboardData_1.getActiveItemsByScope)(items, 'expiryMonth');
    const weekItems = (0, mockDashboardData_1.getActiveItemsByScope)(items, 'expiryWeek');
    strict_1.default.equal(monthItems.length > 0, true);
    strict_1.default.equal(weekItems.length, 0);
});
(0, node_test_1.default)('monotonie recettes: jour ⊂ semaine ⊂ mois ⊂ toutes', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });
    const items = [
        buildItem('d0', 'Œufs', '2026-04-10'),
        buildItem('w3', 'Lait', '2026-04-13'),
        buildItem('m20', 'Riz', '2026-04-30'),
        buildItem('s90', 'Farine', '2026-07-09'),
    ];
    const allRecipes = [
        { id: 'r_day', available_ingredients: ['Œufs'] },
        { id: 'r_week', available_ingredients: ['Lait'] },
        { id: 'r_month', available_ingredients: ['Riz'] },
        { id: 'r_stock', available_ingredients: ['Farine'] },
    ];
    const dayItems = (0, mockDashboardData_1.getActiveItemsByScope)(items, 'expiryDay');
    const weekItems = (0, mockDashboardData_1.getActiveItemsByScope)(items, 'expiryWeek');
    const monthItems = (0, mockDashboardData_1.getActiveItemsByScope)(items, 'expiryMonth');
    const stockItems = (0, mockDashboardData_1.getActiveItemsByScope)(items, 'stock');
    const dayRecipes = (0, recipesScoping_1.filterRecipesByTargetIngredients)(allRecipes, (0, recipesScoping_1.buildTargetIngredientNames)(dayItems));
    const weekRecipes = (0, recipesScoping_1.filterRecipesByTargetIngredients)(allRecipes, (0, recipesScoping_1.buildTargetIngredientNames)(weekItems));
    const monthRecipes = (0, recipesScoping_1.filterRecipesByTargetIngredients)(allRecipes, (0, recipesScoping_1.buildTargetIngredientNames)(monthItems));
    const stockRecipes = (0, recipesScoping_1.filterRecipesByTargetIngredients)(allRecipes, (0, recipesScoping_1.buildTargetIngredientNames)(stockItems));
    const weekIds = new Set(weekRecipes.map((recipe) => recipe.id));
    const monthIds = new Set(monthRecipes.map((recipe) => recipe.id));
    const stockIds = new Set(stockRecipes.map((recipe) => recipe.id));
    strict_1.default.equal(dayRecipes.some((recipe) => recipe.id === 'r_day'), true);
    strict_1.default.equal(weekIds.has('r_day'), true);
    strict_1.default.equal(monthIds.has('r_week'), true);
    strict_1.default.equal(stockIds.has('r_month'), true);
});
(0, node_test_1.default)('filtrage recettes: aucun ingrédient cible normalisable => aucune recette', () => {
    const recipes = [{ id: 'r1', available_ingredients: ['oeufs'] }];
    const filtered = (0, recipesScoping_1.filterRecipesByTargetIngredients)(recipes, new Set());
    strict_1.default.equal(filtered.length, 0);
});
(0, node_test_1.default)('filtrage recettes: exclut les recettes fallback génériques même si les ingrédients matchent', () => {
    const recipes = [
        { id: 'generic-fallback', available_ingredients: ['oeufs'], is_fallback: true },
        { id: 'generic-fallback-debug', available_ingredients: ['oeufs'], debug: { is_fallback: true } },
        { id: 'scoped', available_ingredients: ['oeufs'] },
    ];
    const filtered = (0, recipesScoping_1.filterRecipesByTargetIngredients)(recipes, new Set(['oeuf']));
    strict_1.default.deepEqual(filtered.map((recipe) => recipe.id), ['scoped']);
});
