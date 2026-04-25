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
- Reset / seed via :
  - `POST /api/test/reset`
  - `POST /api/test/seed`
- Ces routes sont **bloquées hors `APP_ENV=test`**.

## Exécution CI
Workflow : `.github/workflows/mobile-e2e.yml`.

Schéma :
1. Démarrage d’un **MongoDB dédié au job E2E** (`mongo:7`, DB `keepeat_e2e_test`).
2. Démarrage backend FastAPI en `APP_ENV=test` avec blocage des services externes.
3. Vérification explicite de disponibilité backend via `/health`.
4. Build APK Android avec `EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:8000` (URL émulateur → host runner).
5. Installation APK sur émulateur.
6. Exécution de chaque flow Maestro **individuellement** avec reset/seed déterministe avant flow.
7. Upload artifacts de diagnostic.

Le backend écoute sur `0.0.0.0:8000` en CI, et l’émulateur Android l’atteint via `10.0.2.2:8000`.

## Reset/seed par scénario
- Script CI : `scripts/e2e-reset-seed.mjs`.
- Mode `seeded` : reset + seed fixtures.
- Mode `empty` : reset uniquement.
- La CI applique ce reset/seed avant chaque flow (`03-stock-empty-state` en mode empty, les autres en seeded).

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
