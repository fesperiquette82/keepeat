export const UI_LABELS = {
  fr: {
    unknownQuantity: 'Quantité non précisée',
    storage: {
      frigo: 'Frigo',
      placard: 'Placard',
    },
    actions: {
      viewStock: 'Voir le stock',
      viewRecipes: 'Voir les recettes',
    },
  },
} as const;

export function storageZoneLabel(zone?: string): string {
  if (zone === 'frigo') {
    return UI_LABELS.fr.storage.frigo;
  }
  return UI_LABELS.fr.storage.placard;
}
