"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const adminAccess_1 = require("./adminAccess");
(0, node_test_1.default)('isAdminUser retourne false sans user', () => {
    strict_1.default.equal((0, adminAccess_1.isAdminUser)(null), false);
});
