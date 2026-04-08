"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_CONFIG = exports.DEFAULT_HOUSEHOLD_SIZE = void 0;
function parseBooleanFlag(value, fallback) {
    if (!value)
        return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized))
        return true;
    if (['0', 'false', 'no', 'off'].includes(normalized))
        return false;
    return fallback;
}
function parseIntegerFlag(value, fallback, min = 1, max = 12) {
    if (!value)
        return fallback;
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, parsed));
}
function resolveAppVariant() {
    const raw = (process.env.EXPO_PUBLIC_APP_VARIANT ?? '').trim().toLowerCase();
    if (raw === 'debug')
        return 'debug';
    if (raw === 'prod' || raw === 'production')
        return 'prod';
    return typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'prod';
}
const appVariant = resolveAppVariant();
const debugByDefault = appVariant === 'debug';
exports.DEFAULT_HOUSEHOLD_SIZE = parseIntegerFlag(process.env.EXPO_PUBLIC_DEFAULT_RECIPE_SERVINGS, 4);
exports.APP_CONFIG = {
    appVariant,
    enableDebugTools: appVariant === 'debug'
        ? parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS, debugByDefault)
        : false,
    enableVerboseLogs: parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_VERBOSE_LOGS, debugByDefault),
    enableDiagnosticScreen: appVariant === 'debug'
        ? parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_DIAGNOSTIC_SCREEN, debugByDefault)
        : false,
    enableNetworkTracing: parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_NETWORK_TRACING, debugByDefault),
    defaultRecipeServings: exports.DEFAULT_HOUSEHOLD_SIZE,
};
