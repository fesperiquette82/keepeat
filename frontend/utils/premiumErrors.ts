export type PremiumErrorCode = 'PREMIUM_REQUIRED' | 'QUOTA_EXCEEDED';

export interface PremiumErrorDetail {
  code: PremiumErrorCode;
  feature?: string;
  remaining?: number;
  reset_at?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function extractPremiumErrorDetail(error: unknown): PremiumErrorDetail | null {
  const detail = asRecord(asRecord(asRecord(asRecord(error)?.response)?.data)?.detail);
  if (!detail) return null;
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
