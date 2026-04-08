"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const monthlyLabels_1 = require("./monthlyLabels");
(0, node_test_1.default)('gère correctement le passage décembre -> janvier', () => {
    const labels = (0, monthlyLabels_1.generateLastSixMonthLabels)(new Date('2026-01-15T00:00:00Z'));
    strict_1.default.deepEqual(labels.map((item) => item.month), ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
    strict_1.default.deepEqual(labels.map((item) => item.label), ['AOÛ 25', 'SEP 25', 'OCT 25', 'NOV 25', 'DÉC 25', 'JAN 26']);
});
(0, node_test_1.default)('n’est pas impacté par une date de référence en année bissextile', () => {
    const labels = (0, monthlyLabels_1.generateLastSixMonthLabels)(new Date('2024-02-29T12:00:00Z'));
    strict_1.default.deepEqual(labels.map((item) => item.month), ['2023-09', '2023-10', '2023-11', '2023-12', '2024-01', '2024-02']);
});
(0, node_test_1.default)('couvre correctement un changement d’année', () => {
    const labels = (0, monthlyLabels_1.generateLastSixMonthLabels)(new Date('2025-12-05T00:00:00Z'));
    strict_1.default.deepEqual(labels.map((item) => item.month), ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']);
});
(0, node_test_1.default)('garantit l’absence de doublons', () => {
    const labels = (0, monthlyLabels_1.generateLastSixMonthLabels)(new Date('2026-03-30T08:30:00Z'));
    const uniqueMonths = new Set(labels.map((item) => item.month));
    strict_1.default.equal(labels.length, 6);
    strict_1.default.equal(uniqueMonths.size, labels.length);
});
