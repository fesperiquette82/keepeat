# Boucle Codex Auto-fix CI

## Fonctionnement
Le workflow `.github/workflows/codex-auto-fix.yml` se déclenche sur `workflow_run: completed` pour les workflows critiques (`CI`, `Mobile E2E (Maestro)`, `Admin dashboard monitoring tests`).

Il continue uniquement si :
- la conclusion du run est `failure`,
- l'événement source du run est `pull_request`.

Ensuite, il :
1. retrouve la PR concernée,
2. refuse les forks non fiables,
3. checkout la branche HEAD de la PR (jamais `main`),
4. lit le nombre de tentatives précédentes via le marqueur commentaire :
   `<!-- codex-autofix-attempt: N -->`,
5. lance Codex avec le prompt versionné,
6. exécute une validation rapide,
7. commit/push sur la branche de PR si nécessaire,
8. commente la PR avec le résultat.

## Limite de tentatives
- Maximum 3 tentatives automatiques par PR.
- Au-delà, la boucle s'arrête et poste un diagnostic clair.

## Secret utilisé
- `OPENAI_API_KEY` est requis pour `openai/codex-action@v1`.
- Le secret n'est jamais affiché dans les logs.

## Lecture des commentaires Codex
Chaque tentative ajoute un commentaire structuré avec :
- numéro de tentative,
- cause probable,
- tests exécutés,
- résultat,
- prochaine étape.

## Arrêter la boucle
La boucle s'arrête automatiquement :
- si 3 tentatives ont déjà été faites,
- si la PR vient d'un fork non fiable,
- si aucun run `pull_request` en échec n'est détecté.

## Gouvernance / garde-fous
- Jamais de push direct sur `main`.
- Jamais de `pull_request_target`.
- Permissions GitHub minimales (`contents`, `pull-requests`, `actions`).
- Interdiction de désactiver les tests, d'affaiblir Maestro, de contourner test-policy, ou de désactiver les garde-fous anti-appels externes.

## Risques connus
- Les logs/artifacts d'un run échoué peuvent être partiels (téléchargement best-effort).
- Certains échecs intermittents nécessitent une intervention humaine malgré 3 tentatives.
- Le workflow n'utilise pas le texte libre des commentaires externes comme prompt pour éviter l'injection.
