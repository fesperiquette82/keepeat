export const UI_LABELS = {
  fr: {
    unknownQuantity: 'Quantité non précisée',
    storage: {
      frigo: 'Frigo',
      placard: 'Placard',
      congelateur: 'Congélateur',
      unknown: 'Zone inconnue',
    },
    actions: {
      viewStock: 'Voir le stock',
      viewRecipes: 'Voir les recettes',
    },
  },
} as const;

export function storageZoneLabel(zone?: string): string {
  if (zone === 'frigo') return UI_LABELS.fr.storage.frigo;
  if (zone === 'placard') return UI_LABELS.fr.storage.placard;
  if (zone === 'congelateur') return UI_LABELS.fr.storage.congelateur;
  return UI_LABELS.fr.storage.unknown;
}
