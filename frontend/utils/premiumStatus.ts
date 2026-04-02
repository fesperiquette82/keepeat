import type { AuthUser, BillingEntitlements } from '../store/authStore';

interface PremiumStatusInput {
  token: string | null;
  plan: 'free' | 'premium';
  user: AuthUser | null;
  entitlements: BillingEntitlements | null;
  error: string | null;
}

export interface PremiumStatusSnapshot {
  isLoading: boolean;
  isPremiumActive: boolean;
  subscriptionStatus: string;
  premiumDate: string | null;
  premiumDateKind: 'renewal' | 'expiration' | null;
}

function isPremiumSyncError(error: string | null): boolean {
  if (!error) return false;
  return error.toLowerCase().includes('premium');
}

export function resolvePremiumStatus(input: PremiumStatusInput): PremiumStatusSnapshot {
  const hasBillingSnapshot = input.entitlements !== null;
  const hasSyncError = isPremiumSyncError(input.error);
  const isLoading = Boolean(input.token) && !hasBillingSnapshot && !hasSyncError;

  if (isLoading) {
    return {
      isLoading: true,
      isPremiumActive: false,
      subscriptionStatus: 'unknown',
      premiumDate: null,
      premiumDateKind: null,
    };
  }

  const entitlementPremium = input.entitlements
    ? (input.entitlements.is_premium || input.entitlements.plan === 'premium')
    : null;
  const isPremiumActive = entitlementPremium
    ?? input.user?.is_premium
    ?? (input.plan === 'premium');

  const subscriptionStatus = (input.entitlements?.subscription_status || (isPremiumActive ? 'active' : 'inactive')).toLowerCase();
  const premiumDate = input.entitlements?.subscription_expires_at ?? null;
  const premiumDateKind = premiumDate
    ? subscriptionStatus === 'active' ? 'renewal' : 'expiration'
    : null;

  return {
    isLoading: false,
    isPremiumActive,
    subscriptionStatus,
    premiumDate,
    premiumDateKind,
  };
}
