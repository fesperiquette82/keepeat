import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRecipesEmptyMessage } from './recipesEmptyState';

const t = (key: string) => {
  const labels: Record<string, string> = {
    recipesFilterExpiryMonth: 'Ce mois',
    recipesEmptyExpiryMonth: 'Aucun produit à consommer ce mois',
    recipesEmptyAll: 'Aucun produit à consommer',
  };
  return labels[key] ?? key;
};

test('état vide: targetItems > 0 et aucune recette => fallback explicite', () => {
  const message = buildRecipesEmptyMessage({
    activeFilter: 'expiryMonth',
    activeStockCount: 3,
    hasTargetItems: true,
    isLoading: false,
    diagnostics: {
      rawRecipesCount: 2,
      fallbackRecipesCount: 0,
      recipesWithAvailableIngredientsCount: 2,
      compatibleRecipesCount: 0,
    },
    translate: t,
  });

  assert.equal(
    message,
    'Aucune recette de la base commune n’utilise les produits ciblés pour ce filtre. Essayez “Toutes” ou élargissez le stock.',
  );
});

test('état vide: targetItems === 0 => message "Aucun produit à consommer ..."', () => {
  const message = buildRecipesEmptyMessage({
    activeFilter: 'expiryMonth',
    activeStockCount: 4,
    hasTargetItems: false,
    isLoading: false,
    diagnostics: {
      rawRecipesCount: 2,
      fallbackRecipesCount: 0,
      recipesWithAvailableIngredientsCount: 2,
      compatibleRecipesCount: 0,
    },
    translate: t,
  });

  assert.equal(message, 'Aucun produit à consommer ce mois');
});

test('état vide: aucune recette réellement compatible dans la base commune', () => {
  const message = buildRecipesEmptyMessage({
    activeFilter: 'stock',
    activeStockCount: 5,
    hasTargetItems: true,
    isLoading: false,
    diagnostics: {
      rawRecipesCount: 0,
      fallbackRecipesCount: 0,
      recipesWithAvailableIngredientsCount: 0,
      compatibleRecipesCount: 0,
    },
    translate: t,
  });

  assert.equal(message, 'Je n’ai trouvé aucune recette dans la base commune pour votre stock actuel.');
});
