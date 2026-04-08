"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPremiumErrorDetail = extractPremiumErrorDetail;
function extractPremiumErrorDetail(error) {
    const detail = error?.response?.data?.detail;
    if (!detail || typeof detail !== 'object')
        return null;
    if (detail.code === 'PREMIUM_REQUIRED' || detail.code === 'QUOTA_EXCEEDED') {
        return {
            code: detail.code,
            feature: typeof detail.feature === 'string' ? detail.feature : undefined,
            remaining: typeof detail.remaining === 'number' ? detail.remaining : undefined,
            reset_at: typeof detail.reset_at === 'string' ? detail.reset_at : undefined,
        };
    }
    return null;
}
