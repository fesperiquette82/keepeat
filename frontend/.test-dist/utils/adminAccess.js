"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdminUser = isAdminUser;
const appConfig_1 = require("./appConfig");
function parseAdminEmails() {
    const raw = process.env.EXPO_PUBLIC_ADMIN_EMAILS?.trim();
    if (!raw)
        return [];
    return raw
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}
function isAdminUser(user) {
    if (!user?.email)
        return false;
    const admins = parseAdminEmails();
    if (admins.length === 0) {
        return appConfig_1.APP_CONFIG.appVariant === 'debug';
    }
    return admins.includes(user.email.toLowerCase());
}
