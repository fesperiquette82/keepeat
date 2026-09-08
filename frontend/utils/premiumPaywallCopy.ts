import type { BillingEntitlements, BillingUsage } from '../store/authStore';

export type PremiumCopyVariantKey = 'rational' | 'time_saver' | 'anti_waste';

interface BenefitTemplate {
  id: string;
  resolve: (ctx: CopyContext) => string;
}

interface PremiumCopyVariant {
  heroTitle: string;
  heroSubtitle: string;
  benefits: BenefitTemplate[];
  ctaLabel: string;
  genericPersonalization: string;
}

interface CopyContext {
  ocrMonthlyLimit: number | null;
  aiMonthlyLimit: number | null;
}

const VARIANTS_FR: Record<PremiumCopyVariantKey, PremiumCopyVariant> = {
  rational: {
    heroTitle: 'Passez à Premium pour piloter votre anti-gaspi avec des repères concrets',
    heroSubtitle: 'Plus d’historique, plus d’automatisation, et des limites adaptées à un usage quotidien.',
    benefits: [
      {
        id: 'ocr',
        resolve: ({ ocrMonthlyLimit }) =>
          `Ajoutez vos courses plus vite avec jusqu’à ${formatMonthlyLimit(ocrMonthlyLimit)} scans ticket par mois.`,
      },
      {
        id: 'ai',
        resolve: ({ aiMonthlyLimit }) =>
          `Générez des idées repas avec votre stock grâce à jusqu’à ${formatMonthlyLimit(aiMonthlyLimit)} recettes IA par mois.`,
      },
      {
        id: 'history',
        resolve: () => 'Accédez aux statistiques avancées Premium pour suivre vos progrès dans la durée.',
      },
      {
        id: 'predictions',
        resolve: () => 'Anticipez mieux le gaspillage avec les prédictions de produits à risque.',
      },
    ],
    ctaLabel: 'Passer à Premium',
    genericPersonalization: 'Premium vous aide à aller plus loin avec un suivi plus complet de vos progrès.',
  },
  time_saver: {
    heroTitle: 'Passez à Premium pour gagner du temps chaque semaine',
    heroSubtitle: 'Moins de saisie manuelle, plus d’actions utiles au bon moment.',
    benefits: [
      {
        id: 'ocr',
        resolve: ({ ocrMonthlyLimit }) =>
          `Ajoutez vos courses en quelques secondes avec jusqu’à ${formatMonthlyLimit(ocrMonthlyLimit)} scans ticket par mois.`,
      },
      {
        id: 'ai',
        resolve: ({ aiMonthlyLimit }) =>
          `Trouvez plus vite quoi cuisiner avec jusqu’à ${formatMonthlyLimit(aiMonthlyLimit)} suggestions IA par mois.`,
      },
      {
        id: 'history',
        resolve: () => 'Repérez rapidement vos habitudes avec les statistiques avancées Premium.',
      },
      {
        id: 'predictions',
        resolve: () => 'Recevez des signaux utiles sur les produits à prioriser avant péremption.',
      },
    ],
    ctaLabel: 'Essayer Premium',
    genericPersonalization: 'Premium simplifie votre routine anti-gaspi pour vous faire gagner du temps au quotidien.',
  },
  anti_waste: {
    heroTitle: 'Passez à Premium pour jeter moins et garder le contrôle',
    heroSubtitle: 'Des outils concrets pour mieux suivre vos produits, vos habitudes et vos économies.',
    benefits: [
      {
        id: 'predictions',
        resolve: () => 'Identifiez les produits à risque plus tôt avec les prédictions anti-gaspi Premium.',
      },
      {
        id: 'ocr',
        resolve: ({ ocrMonthlyLimit }) =>
          `Ajoutez vos courses plus vite avec jusqu’à ${formatMonthlyLimit(ocrMonthlyLimit)} scans ticket par mois.`,
      },
      {
        id: 'ai',
        resolve: ({ aiMonthlyLimit }) =>
          `Cuisinez plus facilement ce que vous avez déjà grâce à jusqu’à ${formatMonthlyLimit(aiMonthlyLimit)} recettes IA par mois.`,
      },
      {
        id: 'history',
        resolve: () => 'Suivez vos progrès anti-gaspi avec les statistiques avancées Premium.',
      },
    ],
    ctaLabel: 'Passer à Premium',
    genericPersonalization: 'Premium vous aide à aller plus loin dans votre routine anti-gaspi.',
  },
};

const DEFAULT_VARIANT: PremiumCopyVariantKey = 'anti_waste';

function formatMonthlyLimit(limit: number | null): string {
  if (!limit || limit <= 0) return 'vos limites Premium';
  return String(limit);
}

/**
 * Limites du plan **vendu**, pas du plan courant (BUG-071).
 *
 * L'argumentaire était construit à partir des droits de l'utilisateur : un
 * compte gratuit voyait donc ses propres limites gratuites (8) présentées comme
 * l'offre Premium (200). Les valeurs ci-dessous reflètent
 * `backend/entitlements.py::PREMIUM_MONTHLY_LIMITS` et ne dépendent plus de
 * l'état du compte qui regarde la page.
 */
export const PREMIUM_PLAN_MONTHLY_LIMITS = {
  ocr_receipt: 200,
  ai_recipes: 200,
} as const;

export function buildPremiumCopy(options: {
  entitlements: BillingEntitlements | null;
  usage: BillingUsage | null;
  variant?: PremiumCopyVariantKey;
}) {
  const variant = VARIANTS_FR[options.variant ?? DEFAULT_VARIANT];
  // BUG-071 : l'offre décrite est TOUJOURS celle du plan Premium. Les droits
  // courants (`options.entitlements`) ne servent plus qu'à situer l'utilisateur,
  // jamais à décrire ce qu'on lui vend — sinon un compte gratuit lisait
  // « jusqu'à 8 scans par mois » dans l'argumentaire Premium.
  const ctx: CopyContext = {
    ocrMonthlyLimit: PREMIUM_PLAN_MONTHLY_LIMITS.ocr_receipt,
    aiMonthlyLimit: PREMIUM_PLAN_MONTHLY_LIMITS.ai_recipes,
  };
  const currentPlan = options.entitlements?.plan ?? 'free';
  const currentOcrLimit =
    options.entitlements?.features?.ocr_receipt?.monthly_limit ??
    options.usage?.usage?.ocr_receipt?.limit ??
    null;
  const currentAiLimit =
    options.entitlements?.features?.ai_recipes?.monthly_limit ??
    options.usage?.usage?.ai_recipes?.limit ??
    null;

  return {
    heroTitle: variant.heroTitle,
    heroSubtitle: variant.heroSubtitle,
    ctaLabel: variant.ctaLabel,
    benefits: variant.benefits.map((benefit) => ({ id: benefit.id, text: benefit.resolve(ctx) })),
    genericPersonalization: variant.genericPersonalization,
    // Plan actuel, présenté séparément de l'offre vendue.
    currentPlan,
    currentOcrLimit,
    currentAiLimit,
    // Le quota « recettes » couvre catalogue ET génération IA côté serveur
    // (FEATURE_AI) : le dire explicitement évite de laisser croire que seules
    // les recettes générées par IA le consomment.
    quotaScopeNote:
      'Le quota de recettes couvre toutes les suggestions affichées, qu’elles viennent du catalogue ou d’une génération IA.',
  };
}

export const PREMIUM_COPY_VARIANTS_AVAILABLE = Object.keys(VARIANTS_FR) as PremiumCopyVariantKey[];
