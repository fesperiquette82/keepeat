import {
  initConnection,
  endConnection,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Subscription,
  type PurchaseError,
} from 'react-native-iap';

type SubscriptionPurchase = any;
import { Platform } from 'react-native';

export const PREMIUM_SKU = 'premium_monthly';

const SKUS = Platform.select({
  android: [PREMIUM_SKU],
  default: [] as string[],
})!;

export async function initIAP(): Promise<boolean> {
  try {
    await initConnection();
    return true;
  } catch {
    return false;
  }
}

export async function endIAP(): Promise<void> {
  try {
    await endConnection();
  } catch {
    // ignore
  }
}

export async function loadSubscription(): Promise<Subscription | null> {
  try {
    // react-native-iap v14 uses different API
    const subs = (await (getAvailablePurchases as any)()) as Subscription[];
    return subs[0] ?? null;
  } catch {
    return null;
  }
}

export type PurchaseResult = {
  purchaseToken: string;
  productId: string;
  transactionId?: string;
};

/**
 * Enregistre les listeners IAP et retourne une fonction de nettoyage.
 * Doit être appelé une seule fois par écran, avant requestSubscription.
 */
export function subscribeToPurchaseUpdates(
  onSuccess: (result: PurchaseResult) => Promise<void>,
  onError: (error: PurchaseError) => void,
): () => void {
  const updateListener = purchaseUpdatedListener(async (purchase: SubscriptionPurchase) => {
    if (!purchase.purchaseToken) return;
    try {
      await onSuccess({
        purchaseToken: purchase.purchaseToken,
        productId: purchase.productId,
        transactionId: purchase.transactionId,
      });
    } finally {
      await finishTransaction({ purchase, isConsumable: false });
    }
  });

  const errorListener = purchaseErrorListener((error: PurchaseError) => {
    onError(error);
  });

  return () => {
    updateListener.remove();
    errorListener.remove();
  };
}

export async function startPurchase(sku: string): Promise<void> {
  // react-native-iap v14 uses different API - stub implementation
  // TODO: Update to use correct v14 API when implementing premium feature
  throw new Error('Not implemented - react-native-iap v14 API needs update');
}

export async function restoreSubscriptions(): Promise<PurchaseResult[]> {
  try {
    const purchases = await getAvailablePurchases();
    return purchases
      .filter((p): p is SubscriptionPurchase => p.productId === PREMIUM_SKU && !!p.purchaseToken)
      .map(p => ({
        purchaseToken: p.purchaseToken!,
        productId: p.productId,
        transactionId: p.transactionId,
      }));
  } catch {
    return [];
  }
}

/**
 * Extrait le prix formaté depuis un objet Subscription Play Store.
 * Supporte l'API Google Play Billing v5+ (subscriptionOfferDetails) et l'ancienne API.
 */
export function getFormattedPrice(sub: Subscription | null): string {
  if (!sub) return '...';
  // Nouvelle API Play Billing v5+ (react-native-iap v14+)
  const offerDetails = (sub as any).subscriptionOfferDetails;
  if (offerDetails?.length) {
    const phases = offerDetails[0]?.pricingPhases?.pricingPhaseList;
    if (phases?.length) {
      return phases[0].formattedPrice ?? (sub as any).localizedPrice ?? '...';
    }
  }
  // Ancienne API de compatibilité
  return (sub as any).localizedPrice ?? '...';
}
