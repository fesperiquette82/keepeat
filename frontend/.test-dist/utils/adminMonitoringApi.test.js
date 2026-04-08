"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const adminMonitoringApi_1 = require("./adminMonitoringApi");
(0, node_test_1.default)('buildPeriodParams crée une fenêtre relative pour 7d', () => {
    const params = (0, adminMonitoringApi_1.buildPeriodParams)('7d');
    strict_1.default.ok(params.start_date);
    strict_1.default.ok(params.end_date);
});
(0, node_test_1.default)('buildPeriodParams conserve les dates custom', () => {
    const params = (0, adminMonitoringApi_1.buildPeriodParams)('custom', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    strict_1.default.equal(params.start_date, '2026-01-01T00:00:00.000Z');
    strict_1.default.equal(params.end_date, '2026-01-02T00:00:00.000Z');
});
(0, node_test_1.default)('refuse les appels sans token auth', async () => {
    await strict_1.default.rejects(() => (0, adminMonitoringApi_1.getMonitoringHealth)(''), /AUTH_TOKEN_MISSING/);
});
