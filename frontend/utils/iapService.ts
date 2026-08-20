import {
  initConnection,
  endConnection,
  fetchProducts,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  requestPurchase,
  type ProductSubscription,
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

export async function loadSubscription(): Promise<ProductSubscription | null> {
  try {
    // fetchProducts({ type: 'subs' }) renvoie le catalogue proposé par le store
    // (prix, offres) — getAvailablePurchases() renvoie l'historique d'achats de
    // l'utilisateur, vide pour quiconque n'a jamais acheté (BUG-002).
    const subs = (await fetchProducts({ skus: SKUS, type: 'subs' })) as ProductSubscription[] | null;
    return subs?.[0] ?? null;
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

/**
 * Déclenche le flux d'achat Google Play pour l'abonnement premium.
 * react-native-iap v14 (API OpenIAP/Nitro) exige le offerToken de l'offre
 * Play Store choisie (`subscriptionOfferDetailsAndroid[0]`) en plus du SKU —
 * il ne suffit pas de passer le SKU seul comme dans les versions antérieures.
 * Le résultat de l'achat arrive de façon asynchrone via le listener enregistré
 * par `subscribeToPurchaseUpdates`, pas via la valeur de retour de cet appel.
 */
export async function startPurchase(product: ProductSubscription): Promise<void> {
  if (product.platform !== 'android') {
    throw new Error('Achat premium disponible uniquement sur Android pour le moment');
  }
  const offer = product.subscriptionOfferDetailsAndroid?.[0];
  if (!offer) {
    throw new Error('Aucune offre disponible pour cet abonnement');
  }
  await requestPurchase({
    type: 'subs',
    request: {
      google: {
        skus: [product.id],
        subscriptionOffers: [{ sku: product.id, offerToken: offer.offerToken }],
      },
    },
  });
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
 * Extrait le prix formaté d'un ProductSubscription (react-native-iap v14+,
 * API OpenIAP/Nitro) : le prix est directement exposé sur `displayPrice`.
 */
export function getFormattedPrice(sub: ProductSubscription | null): string {
  return sub?.displayPrice ?? '...';
}
