"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usePremiumUiStore = void 0;
const zustand_1 = require("zustand");
exports.usePremiumUiStore = (0, zustand_1.create)((set) => ({
    isOpen: false,
    context: null,
    openPaywall: (context) => set({ isOpen: true, context }),
    closePaywall: () => set({ isOpen: false, context: null }),
}));
