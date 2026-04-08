"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const appConfig_1 = require("./appConfig");
const LEVEL_WEIGHT = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const minLevel = appConfig_1.APP_CONFIG.enableVerboseLogs ? 'debug' : 'info';
function shouldLog(level) {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel];
}
function sanitizeError(error) {
    if (error instanceof Error) {
        return { message: error.message, name: error.name };
    }
    return { message: String(error) };
}
function emit(level, message, payload) {
    if (!shouldLog(level))
        return;
    const prefix = `[${level.toUpperCase()}]`;
    if (payload === undefined) {
        console[level](`${prefix} ${message}`);
        return;
    }
    console[level](`${prefix} ${message}`, payload);
}
exports.logger = {
    debug(message, payload) {
        emit('debug', message, payload);
    },
    info(message, payload) {
        emit('info', message, payload);
    },
    warn(message, payload) {
        emit('warn', message, payload);
    },
    error(message, payload) {
        emit('error', message, payload);
    },
    errorFromException(message, error) {
        emit('error', message, sanitizeError(error));
    },
};
