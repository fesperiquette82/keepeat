# Plan de chantier non-régression frontend (lots)

Objectif : industrialiser les tests de non-régression sur les micro-fonctionnalités critiques et les transitions de menus/navigation.

## Lot 1 — Guards de navigation auth/public (en cours)
- Extraire la décision de redirection auth/public dans un helper pur.
- Couvrir les transitions suivantes :
  - utilisateur non connecté sur écran privé → redirection login
  - utilisateur non connecté sur écran public → pas de redirection
  - utilisateur connecté sur login/register → redirection home
  - utilisateur connecté sur autres écrans → pas de redirection
  - état auth non chargé → aucune redirection
- Statut : ✅ implémenté dans ce PR.

## Lot 2 — Flux premium/paywall et transitions bloquantes (partiel)
- Tester les décisions d’ouverture/fermeture du paywall.
- Couvrir les transitions scan/scan-receipt selon statut premium/quota.
- Vérifier qu’aucun écran debug n’est visible en prod.
- Statut : ✅ garde-fou config prod/debug couvert par tests.

## Lot 3 — Flux stock (liste ↔ détail ↔ édition) (partiel)
- Tester les transitions stock tab -> détail produit -> retour tab.
- Ajouter des non-régressions sur cache TTL, force refresh, undo/suppression.
- Vérifier la cohérence des CTA (édition, recettes associées, retours).
- Statut : ✅ retour sécurisé détail stock (fallback tab stock) + test.

## Lot 4 — Flux recettes (filtres, fallback, détail) (partiel)
- Étendre les tests de monotonie des filtres et des états vides.
- Couvrir les transitions recettes tab -> détail recette -> retour.
- Vérifier la cohérence des suggestions (scope validé uniquement, pas de fallback déguisé en personnalisé).
- Statut : ✅ transition détail recette -> retour sécurisée via helper testable.

## Lot 5 — Contrats API frontend et mapping payloads
- Renforcer les tests de normalisation/mapping des réponses backend.
- Couvrir les variantes snake_case/camelCase/champs imbriqués.
- Ajouter des gardes anti-régression sur champs optionnels/absents.

## Lot 6 — Intégration CI/qualité continue (partiel)
- Garantir l’exécution systématique lint + tests sur PR et push `main`.
- Étendre les garde-fous “tests modifiés requis” aux zones critiques identifiées.
- Produire un reporting synthétique des suites de non-régression par domaine.
- Statut : ✅ script de reporting des suites frontend + exécution dans CI.
