# Politique de tests KeepEat

## Objectif

Limiter les régressions produit avec une exécution **rapide en PR** et **complète sur `main`/release**.

## Types de tests

- **Unitaires (priorité haute)**  
  Logique métier pure (dates, filtres, mapping, scoring, règles premium/free, garde-fous).
- **Intégration frontend**  
  Enchaînement de comportements visibles (ex: scope recettes + rendu logique header/list).
- **API/backend**  
  Endpoints critiques, statuts HTTP, payloads JSON, erreurs et sécurité.
- **Contrat frontend/backend**  
  Vérification des champs attendus par le frontend (`backend/tests/test_recipe_suggestions_contract.py`).
- **Smoke tests**  
  Démarrage/chargement minimal (config frontend, health backend).
- **E2E**  
  À garder légers et ciblés (non systématiques à ce stade).

## Commandes locales

### Frontend (`frontend/`)

- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:smoke`
- `npm run test:ci` (rapide, utilisé en PR)
- `npm run test:full` (complet, base pour `main`/release)

### Backend (racine du repo)

- `python -m pytest tests/test_ci_non_regression_policy.py tests/test_critical_regressions.py tests/test_runtime_server.py tests/test_warmup.py tests/test_verify_tests_added_policy_script.py backend/tests/test_critical_bug_regressions.py backend/tests/test_recipe_suggestions_contract.py --tb=short -q` (rapide, PR)
- `python -m pytest tests backend/tests --tb=short -q` (complet, `main`/release)

## CI GitHub Actions (`.github/workflows/ci.yml`)

- **À chaque PR/push** :
  - Frontend lint + `npm run test:ci`
  - Backend suites rapides (policy + non-régression + contrats critiques)
  - Vérification de politique de test (`scripts/verify-tests-added.mjs`)
- **Sur `main`/tags release** :
  - Frontend `npm run test:full` + `npm run build`
  - Backend complet `pytest tests backend/tests`

## E2E mobile Maestro (sans installation locale)

- Workflow dédié : `.github/workflows/mobile-e2e.yml`.
- Le pipeline CI :
  1. démarre un MongoDB dédié E2E (`keepeat_e2e_test`),
  2. démarre le backend FastAPI en `APP_ENV=test` avec services externes mockés,
  3. vérifie `/health`, puis reset/seed les fixtures,
  4. build un APK debug Android (`EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:8000`),
  5. lance chaque flow Maestro sur émulateur avec reset/seed déterministe avant scénario,
  6. publie logs backend, résultats Maestro, logcat émulateur et APK en artifacts.
- Le développeur n’a pas besoin d’installer Maestro localement : un push suffit pour exécuter les scénarios.
- Flows versionnés : `.maestro/*.yaml`.

## Règle de non-régression obligatoire

Script : `scripts/verify-tests-added.mjs`.

Principe :
- si du code applicatif `frontend/` ou `backend/` change, il faut au moins un changement de test ;
- les fichiers de tests pris en compte incluent `frontend/**`, `backend/tests/**` et `tests/**`.

Exceptions acceptées (sans test additionnel) :
- documentation ;
- styles purs ;
- config mineure.

## Ajouter un test pour un bug corrigé

1. Reproduire le bug dans un test qui cible le comportement observable.
2. Vérifier qu’il échoue sans correctif (ou à minima qu’il aurait échoué sur l’ancienne logique).
3. Appliquer le correctif minimal.
4. Relancer les suites pertinentes (`test:ci` / pytest rapide).
