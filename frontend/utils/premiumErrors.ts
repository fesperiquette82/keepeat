export type PremiumErrorCode = 'PREMIUM_REQUIRED' | 'QUOTA_EXCEEDED';

export interface PremiumErrorDetail {
  code: PremiumErrorCode;
  feature?: string;
  remaining?: number;
  reset_at?: string;
}

export function extractPremiumErrorDetail(error: any): PremiumErrorDetail | null {
  const detail = error?.response?.data?.detail;
  if (!detail || typeof detail !== 'object') return null;
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
