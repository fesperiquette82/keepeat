"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_PROD_API_URLS = exports.API_URL_GUARDRAIL_REASON = exports.API_URL_GUARDRAIL_STATUS = exports.API_URL = exports.API_ENV = void 0;
exports.isLocalhostUrl = isLocalhostUrl;
exports.getApiUrlDiagnostics = getApiUrlDiagnostics;
exports.buildApiUrl = buildApiUrl;
const appConfig_1 = require("./appConfig");
const logger_1 = require("./logger");
const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'production').trim().toLowerCase();
const ENV_ALIASES = {
    dev: 'development',
    development: 'development',
    stage: 'staging',
    staging: 'staging',
    prod: 'production',
    production: 'production',
};
const ENV_API_URLS = {
    development: 'http://localhost:8000',
    staging: 'https://keepeat-staging-backend.onrender.com',
    production: 'https://keepeat-backend.onrender.com',
};
function normalizeBaseUrl(url) {
    return url.trim().replace(/\/$/, '');
}
function resolveAppEnv() {
    if (appConfig_1.APP_CONFIG.appVariant === 'debug')
        return 'development';
    return ENV_ALIASES[APP_ENV] ?? 'production';
}
function parseAllowedProdUrls(defaultUrl) {
    const raw = process.env.EXPO_PUBLIC_ALLOWED_PROD_API_URLS?.trim();
    if (!raw)
        return [normalizeBaseUrl(defaultUrl)];
    const urls = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(normalizeBaseUrl);
    return urls.length > 0 ? urls : [normalizeBaseUrl(defaultUrl)];
}
function resolveApiUrl() {
    const appEnv = resolveAppEnv();
    const defaultUrl = ENV_API_URLS[appEnv];
    const explicitUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
    const perEnvUrl = process.env[`EXPO_PUBLIC_BACKEND_URL_${appEnv.toUpperCase()}`]?.trim();
    if (appEnv === 'production') {
        const allowedProdUrls = parseAllowedProdUrls(defaultUrl);
        const candidate = normalizeBaseUrl(perEnvUrl || explicitUrl || defaultUrl);
        if (allowedProdUrls.includes(candidate)) {
            return {
                apiUrl: candidate,
                guardrailStatus: 'ok',
                guardrailReason: 'production_target_allowed',
                allowedProdUrls,
            };
        }
        logger_1.logger.error('[ENV_GUARDRAIL] blocked non-allowed production backend target', {
            candidate,
            allowedProdUrls,
        });
        return {
            apiUrl: normalizeBaseUrl(defaultUrl),
            guardrailStatus: 'blocked',
            guardrailReason: `blocked_non_allowed_prod_target:${candidate}`,
            allowedProdUrls,
        };
    }
    const resolved = normalizeBaseUrl(explicitUrl || perEnvUrl || defaultUrl);
    return {
        apiUrl: resolved,
        guardrailStatus: 'ok',
        guardrailReason: `non_production_${appEnv}`,
        allowedProdUrls: [normalizeBaseUrl(defaultUrl)],
    };
}
const API_RESOLUTION = resolveApiUrl();
exports.API_ENV = resolveAppEnv();
exports.API_URL = API_RESOLUTION.apiUrl;
exports.API_URL_GUARDRAIL_STATUS = API_RESOLUTION.guardrailStatus;
exports.API_URL_GUARDRAIL_REASON = API_RESOLUTION.guardrailReason;
exports.ALLOWED_PROD_API_URLS = API_RESOLUTION.allowedProdUrls;
function isLocalhostUrl(url) {
    return /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url.trim());
}
function getApiUrlDiagnostics() {
    return {
        apiUrl: exports.API_URL,
        likelyInvalidOnAndroidDevice: isLocalhostUrl(exports.API_URL),
    };
}
function buildApiUrl(path) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${exports.API_URL}${normalizedPath}`;
}
