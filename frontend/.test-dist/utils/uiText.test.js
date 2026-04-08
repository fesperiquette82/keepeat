"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const uiText_1 = require("./uiText");
(0, node_test_1.default)('pluralizeFr gère singulier/pluriel', () => {
    strict_1.default.equal((0, uiText_1.pluralizeFr)(1, 'ingrédient'), 'ingrédient');
    strict_1.default.equal((0, uiText_1.pluralizeFr)(2, 'ingrédient'), 'ingrédients');
    strict_1.default.equal((0, uiText_1.pluralizeFr)(0, 'cheval', 'chevaux'), 'chevaux');
});
(0, node_test_1.default)('countLabelFr construit un libellé naturel', () => {
    strict_1.default.equal((0, uiText_1.countLabelFr)(1, 'produit'), '1 produit');
    strict_1.default.equal((0, uiText_1.countLabelFr)(4, 'produit'), '4 produits');
});
(0, node_test_1.default)('formatEuroFr formate en français avec espace avant euro', () => {
    strict_1.default.equal((0, uiText_1.formatEuroFr)(12.5), '12,5 €');
    strict_1.default.equal((0, uiText_1.formatEuroFr)(1000), '1 000 €');
});
