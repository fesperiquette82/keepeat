"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPeriodParams = buildPeriodParams;
exports.getMonitoringHealth = getMonitoringHealth;
exports.getMonitoringDashboard = getMonitoringDashboard;
exports.getMonitoringApis = getMonitoringApis;
exports.getMonitoringUsers = getMonitoringUsers;
exports.getMonitoringSubscriptions = getMonitoringSubscriptions;
exports.getMonitoringServicesUsage = getMonitoringServicesUsage;
exports.getMonitoringEvents = getMonitoringEvents;
exports.getMonitoringServiceStatus = getMonitoringServiceStatus;
exports.getMonitoringUsage = getMonitoringUsage;
exports.getMonitoringCosts = getMonitoringCosts;
const config_1 = require("./config");
function buildQuery(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '')
            return;
        query.set(key, String(value));
    });
    const output = query.toString();
    return output ? `?${output}` : '';
}
async function adminGet(path, token, signal) {
    if (!token?.trim()) {
        throw new Error('AUTH_TOKEN_MISSING');
    }
    const response = await fetch((0, config_1.buildApiUrl)(path), {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('AUTH_REQUIRED');
        }
        if (response.status === 403) {
            throw new Error('ACCESS_DENIED');
        }
        const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? data);
        throw new Error(detail || `ADMIN_API_ERROR_${response.status}`);
    }
    return data;
}
function buildPeriodParams(period, customStart, customEnd) {
    const now = new Date();
    const end = now.toISOString();
    if (period === 'custom') {
        return {
            start_date: customStart,
            end_date: customEnd || end,
        };
    }
    const hours = period === '24h' ? 24 : period === '7d' ? 24 * 7 : 24 * 30;
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
    return {
        start_date: start,
        end_date: end,
    };
}
async function getMonitoringHealth(token, signal) {
    return adminGet('/api/admin/monitoring/health', token, signal);
}
async function getMonitoringDashboard(token, signal) {
    return adminGet('/api/admin/monitoring/dashboard', token, signal);
}
async function getMonitoringApis(token, options, signal) {
    return adminGet(`/api/admin/monitoring/apis${buildQuery(options)}`, token, signal);
}
async function getMonitoringUsers(token, signal) {
    return adminGet('/api/admin/monitoring/users', token, signal);
}
async function getMonitoringSubscriptions(token, signal) {
    return adminGet('/api/admin/monitoring/subscriptions', token, signal);
}
async function getMonitoringServicesUsage(token, options, signal) {
    return adminGet(`/api/admin/monitoring/services-usage${buildQuery(options)}`, token, signal);
}
async function getMonitoringEvents(token, options, signal) {
    return adminGet(`/api/admin/monitoring/events${buildQuery(options)}`, token, signal);
}
async function getMonitoringServiceStatus(token, signal) {
    return adminGet('/api/admin/monitoring/services', token, signal);
}
async function getMonitoringUsage(token, signal) {
    return adminGet('/api/admin/monitoring/usage', token, signal);
}
async function getMonitoringCosts(token, signal) {
    return adminGet('/api/admin/monitoring/costs', token, signal);
}
