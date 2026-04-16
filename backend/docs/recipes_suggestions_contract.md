# Contrat `GET /api/recipes/suggestions` (v2 rétrocompatible)

## Champs principaux par recette
- `id`
- `title`
- `summary`
- `servings`
- `ingredients` (nouveau, structuré)

## `ingredients[]`
Chaque ingrédient contient :
- `name` (string)
- `quantity` (number | null)
- `unit` (`piece|g|kg|ml|cl|l|tsp|tbsp|pinch|pot|jar|can|slice` | null)
- `display_unit` (string | null)
- `display_label` (string | null, **indicatif uniquement**)
- `optional` (bool)
- `available` (bool)
- `matched_stock_item_ids` (string[])
- `missing_quantity` (number | null)
- `is_estimated` (bool)

## Rétrocompatibilité conservée
Les champs legacy restent renvoyés :
- `available_ingredients`
- `missing_ingredients`
- `instructions_summary`
- ainsi que le reste du payload historique.

## Exact vs approximatif
- **Exact immédiat** : `quantity`/`unit` quand la recette source fournit une quantité parseable (ex: `150 g`, `1 tbsp`, `2 piece`).
- **Approximatif explicite** : si la quantité source est absente/incomplète, le backend peut inférer une valeur et marque `is_estimated: true`.
- **À améliorer** : enrichir les recettes source pour réduire les inférences et fiabiliser toutes les quantités au niveau métier.

## Source de vérité UI
- La source de vérité fonctionnelle pour l’UI est `quantity + unit` (éventuellement `display_unit`).
- `display_label` est un champ de commodité backend et ne doit pas empêcher un formatage localisé côté frontend (pluriels, conventions FR, etc.).
