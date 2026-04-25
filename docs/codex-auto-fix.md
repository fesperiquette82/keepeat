# Boucle Codex Auto-fix CI

## Fonctionnement exact
Le workflow `.github/workflows/codex-auto-fix.yml` se déclenche sur `workflow_run: completed` pour les workflows critiques :
- `CI`
- `Mobile E2E (Maestro)`
- `Admin dashboard monitoring tests`

Le job continue uniquement si :
- la conclusion du run est `failure` ;
- l'événement source est `pull_request`.

Ensuite, la boucle exécute les étapes suivantes :
1. résoudre le contexte PR depuis `workflow_run.pull_requests[0]` ;
2. refuser les forks non fiables (`head.repo.full_name` différent du repo cible) ;
3. compter les tentatives précédentes via les commentaires PR marqués `<!-- codex-autofix-attempt: N -->` ;
4. stopper au-delà de 3 tentatives ;
5. checkout explicite de la branche HEAD de la PR ;
6. lancer `openai/codex-action@v1` avec le prompt versionné ;
7. exécuter une validation rapide obligatoire ;
8. commit + push uniquement si diff, et uniquement sur la branche PR ;
9. commenter la PR avec le résultat (succès, aucun changement, ou échec de tentative).

## Limite anti-boucle infinie
- Maximum 3 tentatives automatiques par PR.
- Le compteur repose sur un marqueur de commentaire immuable `codex-autofix-attempt`.
- Après la 3e tentative, la boucle s'arrête et publie un diagnostic de reprise manuelle.
- Une clé de `concurrency` empêche l'exécution concurrente de plusieurs auto-fix pour la même PR.

## Garde-fous sécurité
- Déclenchement en `workflow_run` (pas de `pull_request_target`).
- Permissions minimales (`contents: write`, `pull-requests: write`, `actions: read`).
- Refus des forks non fiables avant toute action de correction.
- Push interdit hors branche PR (`git push origin <head_ref>`).
- Prompt strict : interdiction de désactiver tests/policies/guardrails externes.

## Prompt et secret requis
- Prompt versionné : `.github/codex/prompts/auto-fix-ci.md`.
- Secret requis : `OPENAI_API_KEY` (injecté uniquement dans l'étape `openai/codex-action@v1`).

## Validation rapide avant commit
Toujours rejouée avant commit/push :
- `python -m pytest tests/test_ci_non_regression_policy.py -q`
- `python -m py_compile backend/server.py backend/test_mode.py`
- `frontend`: `npm ci && npm run lint && npm run test:ci` uniquement si des fichiers `frontend/` sont modifiés.

## Risques / limites restantes
- Le téléchargement des artifacts/logs du run en échec est best-effort (`gh run download ... || true`).
- Les pannes intermittentes peuvent dépasser 3 tentatives et nécessiter une reprise humaine.
- La qualité du correctif dépend de la lisibilité des logs du run source.
