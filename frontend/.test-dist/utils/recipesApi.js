"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRecipesSuggestions = fetchRecipesSuggestions;
exports.fetchRecipeById = fetchRecipeById;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const authStore_1 = require("../store/authStore");
const recipesFilter_1 = require("./recipesFilter");
const authHeaders = () => {
    const token = authStore_1.useAuthStore.getState().token;
    return token ? { Authorization: `Bearer ${token}` } : {};
};
async function fetchRecipesSuggestions(filter) {
    const response = await axios_1.default.get((0, config_1.buildApiUrl)(`/api/recipes/suggestions?include_meta=true&filter=${(0, recipesFilter_1.mapRecipesFilterToApi)(filter)}`), { headers: authHeaders() });
    const payload = response.data;
    if (Array.isArray(payload)) {
        return { recipes: payload };
    }
    return payload;
}
async function fetchRecipeById(recipeId) {
    const response = await axios_1.default.get((0, config_1.buildApiUrl)(`/api/recipes/${encodeURIComponent(recipeId)}`), {
        headers: authHeaders(),
    });
    return response.data;
}
