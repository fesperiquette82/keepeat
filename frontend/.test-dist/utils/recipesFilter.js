"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapRecipesFilterToApi = mapRecipesFilterToApi;
const FILTER_MAP = {
    expiryDay: 'expiryDay',
    expiryWeek: 'expiryWeek',
    expiryMonth: 'expiryMonth',
    stock: 'stock',
};
function mapRecipesFilterToApi(filter) {
    return FILTER_MAP[filter];
}
