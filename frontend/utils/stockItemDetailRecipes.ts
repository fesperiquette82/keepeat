import type { RecipeCandidate, StockItemRecipeSections } from './stockItemRecipes';

export interface StockItemDetailRecipeBlock {
  title: string;
  emptyText: string;
  recipes: RecipeCandidate[];
}

export function buildStockItemDetailRecipeBlocks(sections: StockItemRecipeSections): StockItemDetailRecipeBlock[] {
  return [
    {
      title: 'Recettes avec cet ingrédient',
      emptyText: 'Aucune recette ne référence directement cet ingrédient.',
      recipes: sections.directRecipes,
    },
  ];
}
