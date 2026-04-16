import { extractPremiumErrorDetail, PremiumErrorDetail } from './premiumErrors';

export type ReceiptErrorAction =
  | { type: 'fallback' }
  | { type: 'premium'; detail: PremiumErrorDetail };

/**
 * Détermine l'action à effectuer selon l'erreur reçue lors du scan ticket.
 * - Erreur premium / quota → paywall
 * - Toute autre erreur (réseau, serveur, timeout) → fallback (l'image est conservée
 *   dans pendingImage pour un envoi manuel éventuel)
 */
export function resolveReceiptErrorAction(err: unknown): ReceiptErrorAction {
  const premiumDetail = extractPremiumErrorDetail(err);
  if (premiumDetail) return { type: 'premium', detail: premiumDetail };
  return { type: 'fallback' };
}
