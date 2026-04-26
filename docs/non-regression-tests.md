# Tests de non-régression mobile KeepEat

## Objectif
Mettre en place une suite E2E métier exécutable en CI sans installation locale développeur.

## Mocké vs réel
- **Mocké (CI E2E)** : IA, OCR, Open Food Facts, billing, emails, push.
- **Réel** : logique métier backend, auth, navigation et rendu app.
- En `APP_ENV=test` + `DISABLE_EXTERNAL_SERVICES=true`, tout appel externe réel est bloqué côté backend.

## Organisation des scénarios
Les scénarios Maestro sont dans `.maestro/` :
- `00-smoke-launch.yaml` → boot app
- `01-auth-session.yaml` → auth/session
- `02-navigation-main-tabs.yaml` → navigation onglets
- `03-stock-empty-state.yaml` → état vide stock
- `04-stock-add-manual-product.yaml` → ajout manuel
- `05-stock-edit-product.yaml` → édition produit
- `06-scan-known-product.yaml` → scan produit connu mocké
- `07-scan-unknown-product.yaml` → scan produit inconnu
- `08-scan-401-does-not-logout.yaml` → 401 lookup sans logout
- `09-recipes-suggestions.yaml` → suggestions recettes
- `10-recipes-filters-monotonic.yaml` → filtres recettes
- `11-product-detail-associated-recipes.yaml` → recettes associées
- `12-premium-paywall.yaml` → paywall
- `13-backend-error-handling.yaml` → gestion erreur backend

## Fixtures déterministes
- Données déclarées dans `backend/data/test_mode_fixtures.json`.
- Compte E2E seedé pour les flows auth :
  - `email`: `e2e.free@keepeat.test`
  - `password`: `TestPassword123!`
  - plan: free (`is_premium=false`, `subscription_status=inactive`)
  - `email_verified=true` au seed backend
- Reset / seed via :
  - `POST /api/test/reset`
  - `POST /api/test/seed`
- Ces routes sont **bloquées hors `APP_ENV=test`**.

## Exécution CI
Workflow : `.github/workflows/mobile-e2e.yml`.

Schéma :
1. **Changes detection gate** calcule deux décisions :
   - `mobile_apk_required=true/false` (rebuild APK ?)
   - `maestro_required=true/false` (lancer Maestro ?)
2. Si `mobile_apk_required=true` et `maestro_required=true` : build APK Android dédié (job `Build Android debug APK`), upload artifact APK.
3. Si `mobile_apk_required=true` et `maestro_required=true` : job `PR smoke Maestro suite` (Mongo test + backend test-mode + download APK + flows smoke).
4. Si `maestro_required=false` **ou** `maestro_required=true` mais `mobile_apk_required=false` : job `Not required (changes filter)` avec raison explicite dans les logs.

Le backend écoute sur `0.0.0.0:8000` en CI, et l’émulateur Android l’atteint via `10.0.2.2:8000`.

## Quand l’APK est reconstruite
Le build APK est lancé seulement si un fichier pouvant modifier le binaire est modifié, notamment :
- `frontend/**`
- `android/**`
- `assets/**`
- `package.json` / `package-lock.json` (racine et frontend)
- `app.json`, `app.config.*`, `eas.json`
- `babel.config.*`, `metro.config.*`, `tsconfig*.json`

## Quand Maestro smoke peut tourner
Maestro smoke est requis si un changement touche :
- les fichiers APK (`frontend/**`, configs Expo/natives listées ci-dessus),
- **ou** `.maestro/**`,
- **ou** `scripts/run-maestro-e2e.sh` / `scripts/e2e-*`,
- **ou** `.github/workflows/mobile-e2e.yml`.

Si `maestro_required=true` mais `mobile_apk_required=false`, le workflow **ne recompile pas** l’APK ; sans mécanisme d’APK réutilisable configuré, il skippe proprement avec le message :
`No APK rebuild required and no reusable APK configured: skipping Maestro for this run.`

Les changements purement backend/docs/policy ne doivent pas déclencher de build APK.

En cas de doute (ex. `workflow_dispatch` manuel), le workflow force `mobile_apk_required=true` et `maestro_required=true`.

Le filtre est maintenu manuellement. Donc si un jour un nouveau dossier ou fichier impactant l’application mobile est ajouté, il faudra l’ajouter explicitement à la liste des chemins qui déclenchent Mobile E2E.

## Stratégie PR / Nightly / Release
- **PR** : rapide, fiable, bloquant.  
  Si changement mobile détecté, on lance **build APK + smoke Maestro uniquement** (`00-smoke-launch`, `01-auth-session`, `02-navigation-main-tabs`).
- **Nightly** : workflow dédié `.github/workflows/mobile-e2e-nightly.yml` avec **suite Maestro complète**.
- **Release** : exiger la suite Maestro complète + checklist manuelle réelle (compte gratuit/premium, permissions caméra, validation courte sur téléphone réel) avant publication Play Store.

## Reset/seed par scénario
- Script CI : `scripts/e2e-reset-seed.mjs`.
- Mode `seeded` : reset + seed fixtures.
- Mode `empty` : reset uniquement.
- La CI applique ce reset/seed avant chaque flow (`03-stock-empty-state` en mode empty, les autres en seeded).
- Les flows nécessitant une session connectée doivent **faire leur propre login** (ou gérer explicitement le cas déjà connecté) et ne pas dépendre d’un flow précédent.
- Le runner smoke n’utilise pas `adb shell pm clear` : on conserve la baseline stable (force-stop + pause) pour éviter les régressions driver/émulateur.

## Lire les artifacts
- `maestro-results/` : rapport JUnit par flow.
- `backend-e2e.log` : logs backend (health, reset/seed, mocks).
- `emulator-logcat.txt` : logcat Android.
- `~/.maestro/tests` : sorties Maestro (screenshots/logs si générés).
- `app-debug.apk` : binaire exact testé.

## Ajouter un scénario
1. Créer un flow `.maestro/NN-nom.yaml`.
2. Ajouter le flow dans `.maestro/config.yaml`.
3. Si nécessaire, ajouter des `testID` ciblés côté React Native.
4. Vérifier que le scénario n’appelle pas de service externe réel en mode test.

## Ressources volontairement désactivées en CI E2E
- Gemini / OpenAI
- OCR provider
- Open Food Facts
- Billing store API
- Emails
- Push notifications

Aucune installation locale n’est requise : push + consultation des artifacts CI.

## Limites restantes
- Les flows restent dépendants de certains labels UI et de la vitesse de l’émulateur.
- Les scénarios premium complets (achat réel store) ne sont pas testés en E2E CI pour éviter toute consommation externe.
