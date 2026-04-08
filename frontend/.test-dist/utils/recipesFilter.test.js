"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const recipesFilter_1 = require("./recipesFilter");
(0, node_test_1.default)('mapRecipesFilterToApi utilise les alias attendus par le backend', () => {
    strict_1.default.equal((0, recipesFilter_1.mapRecipesFilterToApi)('expiryDay'), 'expiryDay');
    strict_1.default.equal((0, recipesFilter_1.mapRecipesFilterToApi)('expiryWeek'), 'expiryWeek');
    strict_1.default.equal((0, recipesFilter_1.mapRecipesFilterToApi)('expiryMonth'), 'expiryMonth');
    strict_1.default.equal((0, recipesFilter_1.mapRecipesFilterToApi)('stock'), 'stock');
});
