# AGENTS.md

> Automatiquement chargé par les agents IA (Claude Code, Cursor, Copilot, Codex)
> **Source de vérité centralisée**: `.ai/core-rules.md`

## 🔗 Règles centralisées dans `.ai/`

Lire et appliquer strictement, dans cet ordre de priorité :

1. **`.ai/core-rules.md`** — Règles universelles non négociables
2. **`.ai/task-flow.md`** — Workflow de développement (TDD, phases)
3. **`.ai/test-policy.md`** — Politique de tests (pyramide, conventions)
4. **`.ai/review-checklist.md`** — Checklist auto-revue
5. **`.ai/stacks/react-native-expo.md`** — Conventions frontend (Node.js --test, TypeScript strict)
6. **`.ai/stacks/python-fastapi.md`** — Conventions backend (pytest, mypy strict)
7. **`.ai/stacks/e2e-maestro.md`** — Conventions E2E (Maestro, testID)

Tous les points suivants sont des résumés ; **en cas d'ambiguïté, `.ai/core-rules.md` prime.**

## Objectif
Faire des correctifs incrémentaux, fiables, et faciles à relire.

## Projet
KeepEat est une application mobile construite avec Expo / React Native.
Le dépôt contient :
- `frontend/` pour l’application mobile
- `backend/` pour le backend FastAPI

## Gestionnaire de paquets
Utiliser `npm` uniquement.
Ne pas utiliser `yarn` ni `pnpm` dans ce dépôt.

## Méthode
- Inspecter d’abord, modifier ensuite.
- Pour toute tâche complexe : proposer un plan court.
- Implémenter le plus petit patch utile.
- Réutiliser les fonctions, hooks, wrappers et config existants.
- Éviter les flux parallèles pour une même donnée produit.

## Règles de travail
Pour chaque correction de bug ou nouvelle fonctionnalité :
1. ajouter ou mettre à jour au moins un test automatisé de non-régression
2. exécuter les tests pertinents
3. si les tests échouent, corriger le code puis relancer les tests
4. ne pas considérer la tâche comme terminée tant que :
   - l’implémentation n’est pas terminée
   - le test de non-régression n’existe pas
   - le lint ne passe pas
   - les tests pertinents ne passent pas

## Règles produit
- Une section UI ne doit jamais être présentée comme personnalisée si ses données viennent d’un fallback générique.
- Les suggestions affichées doivent provenir du flux réellement validé par les garde-fous applicables.
- Les outils de debug doivent être activés par config/flags centralisés uniquement.
- Les composants debug ne doivent jamais être visibles en prod.

## Logs / sécurité
- Utiliser un logger central si disponible.
- Ne pas laisser de `console.log` dispersés.
- Ne jamais logger secrets, tokens ou données sensibles.

## Politique de test
Une modification de code sans test de non-régression est considérée comme incomplète, sauf s’il existe une raison technique clairement explicitée.

Lorsqu’on modifie :
- la logique d’expiration / de durée de conservation
- le filtrage / le périmètre des recettes
- les états vides
- la cohérence stock / recettes
- le mapping des réponses API

il faut ajouter ou mettre à jour des tests couvrant exactement la régression concernée.

## Commandes frontend
À exécuter depuis `frontend/` :
- installation : `npm ci`
- lint : `npm run lint`
- tests unitaires : `npm run test`
- tests CI : `npm run test:ci`

Stack de test frontend actuelle (temporaire) :
- `npm run test` / `npm run test:ci` compilent TypeScript puis exécutent les tests avec `node --test`
- ne pas réintroduire Jest tant que la migration n'est pas explicitement demandée

## Commandes backend
À exécuter depuis `backend/` :
- installation : `pip install -r requirements.txt`
- tests : `pytest`

## Stratégie de test privilégiée
Privilégier d’abord les tests de logique métier pure :
- parsing des dates et `daysUntil`
- périmètres de filtres recettes
- target items / target ingredients
- décisions d’état vide
- normalisation des payloads API

Pour les problèmes d’UI, préférer extraire la logique dans des helpers testables quand c’est possible.

## Vérifications
Après modification :
- exécuter lint
- exécuter les tests ciblés pertinents
- résumer les résultats
- signaler clairement ce qui n’a pas pu être vérifié

## Définition de terminé
Une tâche est terminée uniquement si :
- l’implémentation est complète
- les tests de non-régression ont été ajoutés ou mis à jour
- les tests pertinents passent localement
- le lint passe
- le résumé indique quels tests ont été ajoutés et exécutés
- **pour toute nouvelle fonctionnalité côté application : sa vérification est intégrée dans le dashboard admin** (monitoring d’usage, indicateur de santé, page de suivi ou entrée dans un écran existant selon la nature de la fonctionnalité)

## Sortie attendue
Toujours fournir :
- fichiers modifiés
- résumé du changement
- vérifications exécutées
- risques restants

## Format du résumé de pull request
Chaque résumé de PR doit inclure :
1. cause
2. fichiers modifiés
3. tests ajoutés / mis à jour
4. commandes exécutées
5. risques restants