/**
 * Message utilisateur pour un échec de vérification d'achat premium (BUG-062).
 *
 * Le backend distingue désormais trois échecs très différents, là où il
 * accordait auparavant le Premium dans tous les cas :
 *  - 402 PURCHASE_REJECTED        → Google refuse l'achat, rien à réessayer.
 *  - 503 VERIFICATION_UNAVAILABLE → vérification impossible pour l'instant ;
 *    l'achat n'est pas perdu, il sera rejoué (la transaction n'est pas
 *    acquittée côté Google tant que l'activation n'a pas abouti).
 *  - 409 PURCHASE_TOKEN_ALREADY_LINKED → l'abonnement appartient à un autre
 *    compte KeepEat.
 * Les confondre dans un unique « Contactez le support » pousse l'utilisateur à
 * ouvrir un ticket là où il suffit d'attendre.
 */

type ApiErrorLike = {
  response?: { status?: number; data?: { detail?: { code?: string } | string } };
};

export function extractPurchaseErrorCode(error: unknown): string | null {
  const detail = (error as ApiErrorLike)?.response?.data?.detail;
  if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
    return detail.code;
  }
  return null;
}

export function describePurchaseVerificationError(error: unknown): string {
  const code = extractPurchaseErrorCode(error);
  const status = (error as ApiErrorLike)?.response?.status;

  if (code === 'VERIFICATION_UNAVAILABLE' || status === 503) {
    return "Impossible de vérifier l'achat pour le moment (service indisponible). Votre paiement n'est pas perdu : rouvrez l'app dans quelques minutes, l'activation sera reprise automatiquement.";
  }
  if (code === 'PURCHASE_REJECTED' || code === 'PAYMENT_NOT_RECEIVED') {
    return "Google Play n'a pas confirmé ce paiement. Si votre compte a été débité, contactez le support avec votre reçu Google Play.";
  }
  if (code === 'PURCHASE_TOKEN_ALREADY_LINKED') {
    return 'Cet abonnement est déjà rattaché à un autre compte KeepEat. Connectez-vous avec ce compte, ou contactez le support.';
  }
  return "Impossible de vérifier l'achat. Contactez le support si le problème persiste.";
}
