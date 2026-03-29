# AGENTS.md

## Objectif
Faire des correctifs incrémentaux, fiables, et faciles à relire.

## Méthode
- Inspecter d’abord, modifier ensuite.
- Pour toute tâche complexe : proposer un plan court.
- Implémenter le plus petit patch utile.
- Réutiliser les fonctions, hooks, wrappers et config existants.
- Éviter les flux parallèles pour une même donnée produit.

## Règles produit
- Une section UI ne doit jamais être présentée comme personnalisée si ses données viennent d’un fallback générique.
- Les suggestions affichées doivent provenir du flux réellement validé par les garde-fous applicables.
- Les outils de debug doivent être activés par config/flags centralisés uniquement.
- Les composants debug ne doivent jamais être visibles en prod.

## Logs / sécurité
- Utiliser un logger central si disponible.
- Ne pas laisser de `console.log` dispersés.
- Ne jamais logger secrets, tokens ou données sensibles.

## Vérifications
Après modification :
- exécuter lint
- exécuter les tests ciblés pertinents
- résumer les résultats
- signaler clairement ce qui n’a pas pu être vérifié

## Sortie attendue
Toujours fournir :
- fichiers modifiés
- résumé du changement
- vérifications exécutées
- risques restants