/**
 * Politique d'acquittement d'un achat Google Play (BUG-062).
 *
 * `finishTransaction` déclare l'achat traité auprès de Google : après cet
 * appel, Google ne le represente plus. L'implémentation d'origine l'appelait
 * dans un `finally`, donc y compris quand l'activation serveur venait
 * d'échouer — l'utilisateur était débité, l'achat considéré comme consommé, et
 * l'app n'avait aucun droit à afficher. La règle est donc : **on n'acquitte
 * qu'après activation confirmée**. Un achat non acquitté est represente par
 * Google au prochain lancement, ce qui rejoue l'activation tout seul.
 *
 * Extrait de `iapService.ts` — qui importe des modules natifs et n'est donc pas
 * chargeable dans les tests Node — pour que cette règle soit vérifiable
 * autrement que par inspection du texte source.
 */

export type AcknowledgementDeps<TPurchase, TResult> = {
  /** Active les droits côté serveur. Rejette si l'activation échoue. */
  activate: (purchase: TPurchase) => Promise<TResult>;
  /** Acquitte l'achat auprès du store. */
  finish: (purchase: TPurchase) => Promise<unknown>;
  /** Remonte l'échec à l'écran appelant. */
  onError: (error: unknown) => void;
  /** Journalisation (logger central côté app). */
  logWarn?: (message: string, error: unknown) => void;
};

export type AcknowledgementOutcome = 'acknowledged' | 'left-pending';

export async function processPurchaseUpdate<TPurchase, TResult>(
  purchase: TPurchase,
  deps: AcknowledgementDeps<TPurchase, TResult>,
): Promise<AcknowledgementOutcome> {
  try {
    await deps.activate(purchase);
  } catch (err) {
    deps.logWarn?.(
      '[IAP] activation serveur échouée — transaction laissée non confirmée',
      err,
    );
    deps.onError(err);
    return 'left-pending';
  }
  await deps.finish(purchase);
  return 'acknowledged';
}
