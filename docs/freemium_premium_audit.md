# Audit technique freemium/premium (code existant)

Date d'audit: 2026-03-31
Périmètre: backend FastAPI + frontend Expo/React Native.

## 1) État actuel: fonctionnalités ouvertes à tous

## Fonctionnalités backend exposées

| Domaine | Endpoint(s) | Auth | Gating premium/quota actuel | Observations |
|---|---|---|---|---|
| Santé/build | `/health`, `/api/health`, `/api/build-info` | Public | Aucun | Diagnostic environnement. |
| Authentification | `/api/auth/*` | Public (sauf `/auth/me`) | Aucun | `is_premium` est présent dans le profil utilisateur retourné. |
| Stock | `/api/stock*` + consume/throw/update/history/priority | Requis | Aucun | Toutes les opérations stock sont disponibles pour tout utilisateur authentifié. |
| Stats | `/api/stats`, `/api/stats/monthly`, `/api/gamification` | Requis | Aucun | Pas de limite par plan. |
| Catalogue produit | `/api/product/{barcode}` | Public | Aucun | Lookup + shelf-life pour tous. |
| Notifications | `/api/push-token`, `/api/alerts/preferences`, `/api/recalls/status` | Requis | Aucun | Préférences alertes modifiables pour tous. |
| Recettes catalogue | `/api/recipes/suggestions`, `/api/recipes/suggestions-grouped`, `/api/recipes/catalog` | Requis sauf catalog | Aucun | Pas de distinction free/premium. |
| OCR ticket | `/api/ocr/receipt` | Requis | Aucun | Appel IA potentiellement coûteux, non limité par plan. |
| Recettes IA | `/api/recipes/ai` | Requis | Aucun | Vérifie seulement présence clé OpenAI serveur. |
| Prédictions | `/api/predictions` | Requis | Aucun | Accès libre si connecté. |

## Fonctionnalités frontend visibles

| Domaine UI | Écran/composant principal | Source de données | Gating premium actuel |
|---|---|---|---|
| Dashboard | `frontend/app/(tabs)/index.tsx` | Store stock + mock recipes locales | Aucun |
| Stock complet | `frontend/app/(tabs)/stock.tsx` | Store stock | Aucun |
| Recettes | `frontend/app/(tabs)/recipes.tsx` + détail recette | Mock local via `mockDashboardData` | Aucun |
| Scanner code-barres | `frontend/app/scan.tsx` + `add-product.tsx` | Caméra + API `/api/product`, `/api/stock` | Aucun |
| Scanner ticket OCR | `frontend/app/scan-receipt.tsx` | API `/api/ocr/receipt` puis ajout stock | Aucun |
| Stats/gamification | `frontend/app/(tabs)/stats.tsx` | `/api/stats/monthly`, `/api/gamification` | Aucun |
| Paramètres rappels | `frontend/app/settings.tsx` + settings store | local + `/api/stock/priority/refresh` | Aucun |
| Offline sync | `useNetworkSync`, `stockStore` | queue locale + flush API | Aucun |

## 2) Logique premium/entitlement/quota/paywall existante

### Ce qui existe déjà

- Champ utilisateur `is_premium` dans les modèles API, stocké en DB, injecté dans login/me/verify-email.
- Endpoint admin dédié pour activer/désactiver le premium: `PUT /api/admin/users/{email}/set-premium` protégé par `X-Admin-Key`.
- Frontend stocke `is_premium` dans `AuthUser` (Zustand), mais ne s'en sert pas pour conditionner des parcours.

### Ce qui n'existe pas

- Aucun moteur d'entitlements (ex: plan/features map, droits dynamiques, expiration d'abonnement).
- Aucune notion d'abonnement (produit, période, statut actif, renewal, grace period, cancellation).
- Aucune vérification de reçu/transaction Play Billing côté backend.
- Aucune restauration d'achat côté frontend.
- Aucun paywall UI.
- Aucun quota business (quotas free/premium): uniquement des `limit` techniques (pagination/volume de réponse), non liés au plan.
- Le `Limiter` slowapi est initialisé mais non appliqué à des routes via décorateurs.

## 3) Meilleures candidates premium (basé sur coût + valeur)

1. **OCR ticket (`/api/ocr/receipt`)**
   - Coût externe IA + valeur perçue forte.
   - Recommandation: quota mensuel free + illimité/élevé premium.
2. **Recettes IA (`/api/recipes/ai`)**
   - Coût IA direct + feature “wow”.
   - Recommandation: premium direct, ou free trial limité (ex: 5/mois).
3. **Analytics avancées**
   - `/api/stats/monthly` actuellement jusqu'à 24 mois possible.
   - Recommandation: free 3-6 mois, premium historique 24 mois + insights avancés.
4. **Prédictions anti-gaspillage (`/api/predictions`)**
   - Valeur premium claire (reco proactive).
   - Recommandation: premium ou free limité (ex: top 3 items).
5. **Automatisations notifications avancées**
   - Préférences/refresh déjà en place.
   - Recommandation: laisser alertes de base free, réserver modes avancés premium.

## 4) Où modifier le code pour implémenter

### A. Statut premium / entitlements

**Backend**
- Étendre schéma user: `plan_tier`, `subscription_status`, `entitlements`, `subscription_expires_at`, `store_platform`, `store_product_id`, `store_purchase_token`.
- Créer un module de policy d'accès central (ex: `backend/entitlements.py`) utilisé par endpoints coûteux.
- Ajouter endpoint de lecture d'entitlements pour sync mobile (ex: `GET /api/billing/entitlements`).

**Frontend**
- Étendre `AuthUser` + store auth pour recevoir/rafraîchir entitlements.
- Ajouter hook central `useEntitlements()` pour la UI.

### B. Limitations gratuites

**Backend (enforcement prioritaire)**
- Appliquer gardes dans:
  - `/api/ocr/receipt`
  - `/api/recipes/ai`
  - `/api/predictions`
  - potentiellement `/api/stats/monthly` (fenêtre free)
- Retourner erreurs explicites (ex: `402/403` + code métier `PREMIUM_REQUIRED` ou `QUOTA_EXCEEDED`).

**Frontend**
- Intercepter codes métier et ouvrir paywall contextualisé.

### C. Quotas

**Backend**
- Créer collection dédiée (ex: `usage_counters`) par user+feature+période (mensuelle).
- Fonctions atomiques d'incrément et lecture restante.
- Endpoint `GET /api/billing/usage` pour afficher consommation.

**Frontend**
- Afficher jauges restantes (OCR/IA).

### D. Paywall

**Frontend seulement (UI + orchestration achat)**
- Créer écran/modal paywall (ex: `frontend/app/premium.tsx` ou composant dédié).
- Brancher depuis écrans qui déclenchent une feature premium/quota dépassé.
- Ajouter copy claire Free vs Premium, pricing, CTA abonnement.

### E. Gestion abonnement (Play)

**Frontend**
- Intégrer SDK IAP/Billing (expo in-app purchases ou react-native-iap selon stack cible).
- Flows: fetch products, purchase, acknowledge.

**Backend**
- Endpoint de validation serveur (ex: `POST /api/billing/google/verify`) recevant purchase token.
- Vérification via API Google Play Developer.
- Persistance statut et entitlements.
- Webhook/RTDN (Real-time developer notifications) pour renouvellement, annulation, expiration.

### F. Restauration d'achat

**Frontend**
- Bouton “Restaurer mes achats” dans settings/paywall.
- Appel store pour récupérer achats actifs + renvoi backend verification.

**Backend**
- Endpoint idempotent de revalidation d'un achat existant.

### G. Synchronisation frontend/backend

- Source de vérité = backend (jamais seulement client).
- Au login + reprise app: refresh entitlements depuis backend.
- Après achat/restauration: backend confirme, frontend invalide cache et recharge `auth/me` + entitlements.
- Offline: ne jamais débloquer premium définitivement en local sans confirmation backend.

## 4.bis) Branchement technique précis (points d’injection réels dans le code)

### Backend — contrôle d’accès et quotas

#### 1) Ajouter un module central d’entitlements
- **Nouveau fichier recommandé**: `backend/entitlements.py`
- Fonctions attendues:
  - `async def resolve_entitlements(users_col, user_id) -> EntitlementSnapshot`
  - `def require_entitlement(snapshot, feature_key) -> None`
  - `async def check_and_consume_quota(app_state_col, user_id, feature_key, period_key, limit) -> QuotaResult`
- Pourquoi ici: éviter de dupliquer la logique dans chaque route.

#### 2) Point d’injection commun dans les routes protégées
- **Fichier**: `backend/server.py`
- **Point existant à exploiter**: `_get_current_user` (retourne déjà le user sérialisé).
- **Branchement concret**:
  - Conserver `_get_current_user` tel quel (auth).
  - Ajouter un helper route-level (ex: `_enforce_feature_access`) appelé en début des handlers premium/quota.

#### 3) Endpoints où brancher les gardes d’accès
- `@api_router.post("/ocr/receipt")` → fonction `ocr_receipt_route`
  - Garde: entitlement `ocr_receipt`.
  - Quota: incrément mensuel avant appel IA.
- `@api_router.get("/recipes/ai")` → fonction `get_ai_recipes`
  - Garde: entitlement `ai_recipes`.
  - Quota: incrément mensuel avant requête OpenAI.
- `@api_router.get("/predictions")` → fonction `get_predictions`
  - Garde: entitlement `predictions`.
- `@api_router.get("/stats/monthly")` → fonction `get_monthly_stats`
  - Garde partielle: limiter `months` côté free (ex: `min(requested, 6)`).

#### 4) Nouveau namespace billing à ajouter dans `server.py`
- Router recommandé:
  - `GET /api/billing/entitlements` (snapshot pour app mobile)
  - `GET /api/billing/usage` (quotas restants)
  - `POST /api/billing/google/verify` (validation token Play)
  - `POST /api/billing/restore` (revalidation achats actifs)
- Ces routes doivent réutiliser `resolve_entitlements` + persistence user.

#### 5) Structure de persistence recommandée (Mongo)
- **`users`** (étendre document existant):
  - `plan_tier`, `subscription_status`, `subscription_expires_at`, `store_platform`, `store_product_id`, `store_purchase_token`, `entitlements`, `entitlements_updated_at`.
- **`app_state` ou nouvelle collection `usage_counters`**:
  - clé composite `user_id + feature_key + period` pour compteur atomique.
  - index unique sur cette clé.

#### 6) Codes d’erreur métier à standardiser
- Dans les routes ci-dessus:
  - premium requis: `HTTP 403` + `detail={"code":"PREMIUM_REQUIRED",...}`
  - quota dépassé: `HTTP 429` (ou 403 selon policy) + `detail={"code":"QUOTA_EXCEEDED",...}`
- Objectif: permettre à l’app de déclencher paywall sans heuristique fragile.

### Frontend — paywall, restauration et sync

#### 1) État auth/entitlements
- **Fichier**: `frontend/store/authStore.ts`
- Étendre `AuthUser` avec champs entitlements/souscription.
- Ajouter actions:
  - `refreshEntitlements()`
  - `syncAfterPurchase()`
- Point d’appel initial: `loadAuth()` puis fetch backend `GET /api/billing/entitlements`.

#### 2) Gestion globale des erreurs premium/quota
- **Fichier**: `frontend/store/stockStore.ts` + appels axios des écrans
- Branchement:
  - intercepter réponses API `PREMIUM_REQUIRED` / `QUOTA_EXCEEDED`.
  - remonter un état UI global (ex: `premiumGateEvent`) pour ouvrir paywall.

#### 3) Écrans à brancher en priorité
- `frontend/app/scan-receipt.tsx`
  - si erreur quota/premium sur `/api/ocr/receipt`: ouvrir paywall contextualisé.
- `frontend/app/(tabs)/stats.tsx`
  - si accès refusé stats avancées: fallback UI + CTA premium.
- (si branché plus tard) écran recettes IA dédié: même pattern.

#### 4) Restauration d’achat
- **Settings**: `frontend/app/settings.tsx`
- Ajouter bouton "Restaurer mes achats" → flux:
  1. SDK store: récupérer achats actifs.
  2. Backend `/api/billing/restore` ou `/api/billing/google/verify`.
  3. `authStore.refreshEntitlements()`.

#### 5) Synchronisation online/offline
- **Fichier**: `frontend/utils/useNetworkSync.ts` + `stockStore.setOnline/flushPendingMutations`
- Ajouter, lors du retour online:
  - refresh entitlements avant relance des actions premium en file.
  - éviter d’exécuter une mutation premium offline non autorisée sans revalidation serveur.

### Ordre d’implémentation technique recommandé (très concret)

1. Créer `backend/entitlements.py` + tests unitaires isolés.
2. Ajouter `GET /api/billing/entitlements` et brancher `authStore.refreshEntitlements`.
3. Gater `ocr_receipt_route` et `get_ai_recipes` (impact coût immédiat).
4. Ajouter compteur quota Mongo + endpoint `GET /api/billing/usage`.
5. Ajouter paywall UI + mapping erreurs API.
6. Intégrer achat/restore Play Billing + verify backend.

## Proposition Free vs Premium

| Feature | Free proposé | Premium proposé | Enforcement principal |
|---|---|---|---|
| Stock CRUD | Illimité (ou quota haut) | Illimité | Backend stock endpoints |
| Scan code-barres produit | Illimité | Illimité | Backend `/api/product` |
| OCR ticket | 10/mois | 100+/mois (ou illimité) | Backend `/api/ocr/receipt` + quotas |
| Recettes catalogue | Inclus | Inclus + filtres avancés optionnels | Backend recipes catalog/suggestions |
| Recettes IA | 3-5/mois (trial) | Illimité/élevé | Backend `/api/recipes/ai` + quotas |
| Stats mensuelles | 3-6 mois d'historique | 24 mois + insights | Backend `/api/stats/monthly` |
| Prédictions | limité (top N) | complet | Backend `/api/predictions` |
| Alertes push de base | Inclus | Inclus | endpoints push/alerts |
| Optimisations avancées (à créer) | Non | Oui | Nouveaux endpoints premium |

## Plan d'implémentation priorisé

1. **Fondation backend entitlement/usage**
   - Schémas DB + policy centralisée + codes erreurs métier.
2. **Gating backend des endpoints coûteux**
   - OCR, recettes IA, prédictions, stats mensuelles.
3. **Sync frontend entitlement**
   - Store + hook + gestion erreurs quota/premium.
4. **Paywall UI + instrumentation**
   - Surface d'upgrade cohérente et traçable.
5. **Play Billing E2E**
   - Achat, verify serveur, restore, cycle de vie abonnement.
6. **Observabilité et anti-fraude**
   - logs métier, alertes, détection anomalies.

## Risques avant publication Play Store

1. **Conformité Play Billing**
   - Toute monétisation digitale in-app doit passer par Play Billing côté Android.
2. **Faille de sécurité si gating côté client uniquement**
   - Les contrôles doivent être côté backend.
3. **Incohérence état abonnement**
   - Sans webhook + refresh régulier, risque de droits obsolètes.
4. **Expérience dégradée si erreurs quota non gérées UX**
   - Doit afficher un message clair + CTA upgrade + statut restant.
5. **Coûts IA non maîtrisés**
   - Sans quotas et alerting usage, risque financier.
6. **Cas offline**
   - Nécessité de stratégie explicite (grace courte vs blocage) pour éviter contournements.

## V1 Play Store — plan d’implémentation minimal, réaliste et maintenable

### Objectif V1

Livrer un freemium simple en limitant la complexité backend/front:
- **1 seul abonnement payant** (`premium_monthly`), pas d’annuel en V1.
- **2 états utilisateur** seulement: `free` / `premium`.
- **2 types de garde** seulement: `premium_required` et `monthly_quota`.

### Offre V1 recommandée (simple)

- **Free**
  - Stock, scan code-barres, stats de base, notifications de base.
  - OCR ticket: **10 scans/mois**.
  - Recettes IA: **5 générations/mois**.
  - Prédictions: **bloqué** (premium).
- **Premium**
  - OCR ticket: quota élevé (ex: 200/mois) ou illimité.
  - Recettes IA: quota élevé (ex: 200/mois) ou illimité.
  - Prédictions activées.
  - Historique stats mensuelles complet (24 mois).

### Écrans et actions exactes à limiter en V1

#### 1) `frontend/app/scan-receipt.tsx`
- **Action à limiter**: capture + envoi OCR (`POST /api/ocr/receipt`).
- **Règle V1**:
  - Free: autorisé tant que quota OCR mensuel > 0.
  - Sinon: paywall + indication quota restant.

#### 2) écran recettes IA (à créer ou brancher depuis recettes)
- **Action à limiter**: génération IA (`GET /api/recipes/ai`).
- **Règle V1**:
  - Free: quota mensuel.
  - Dépassement: paywall.

#### 3) `frontend/app/(tabs)/stats.tsx`
- **Action à limiter**:
  - `GET /api/predictions` (si exposé UI).
  - `GET /api/stats/monthly` au-delà de la fenêtre free.
- **Règle V1**:
  - Free: max 6 mois + pas de prédictions.
  - Premium: 24 mois + prédictions.

#### 4) `frontend/app/settings.tsx`
- **Action à ajouter**:
  - CTA "Passer Premium".
  - CTA "Restaurer mes achats".

### Branchement propre des droits dans le code existant

#### Backend (source de vérité)

1. **Nouveau module** `backend/entitlements.py`
   - centralise:
     - résolution du plan (`free`/`premium`),
     - vérification d’accès feature,
     - consommation quota mensuel.

2. **Injection route-level uniquement** dans `backend/server.py` (pas de logique dispersée)
   - `ocr_receipt_route`:
     - `check_access(feature="ocr_receipt")`
     - `consume_quota(feature="ocr_receipt")`
   - `get_ai_recipes`:
     - `check_access(feature="ai_recipes")`
     - `consume_quota(feature="ai_recipes")`
   - `get_predictions`:
     - `check_access(feature="predictions")`
   - `get_monthly_stats`:
     - clamp `months` à 6 si free, 24 si premium.

3. **Nouveaux endpoints V1 minimum**
   - `GET /api/billing/entitlements`
   - `GET /api/billing/usage`
   - `POST /api/billing/google/verify`
   - `POST /api/billing/restore`

4. **Contrat d’erreurs unique**
   - `PREMIUM_REQUIRED`
   - `QUOTA_EXCEEDED`
   - payload homogène avec `feature`, `remaining`, `reset_at`.

#### Frontend (UI et orchestration)

1. **`frontend/store/authStore.ts`**
   - ajouter état `entitlements` + action `refreshEntitlements()`.
   - appeler refresh au login, au démarrage app, et après achat/restauration.

2. **Interception API centralisée**
   - dans stores/appels API (stock + recipes + stats), mapper:
     - `PREMIUM_REQUIRED` -> ouvrir paywall.
     - `QUOTA_EXCEEDED` -> ouvrir paywall + message quota.

3. **Paywall unique V1**
   - un seul écran/composant (ex: `frontend/app/premium.tsx`) réutilisé partout.
   - évite duplications de logique par écran.

4. **Restauration**
   - bouton dans Settings -> flow store -> verify backend -> `refreshEntitlements()`.

### Timeline V1 (pragmatique, 4 étapes)

1. **Backend guardrail**
   - `entitlements.py` + guards sur OCR/IA/predictions/stats.
2. **Billing minimal**
   - verify + restore + entitlements/usage endpoints.
3. **Frontend access wiring**
   - authStore enrichi + paywall unique + interception erreurs.
4. **Play Store readiness**
   - tests achat/restauration en sandbox + QA offline/online.

### Ce qu’on évite volontairement en V1 (pour rester simple)

- Pas de multi-plans (mensuel + annuel + famille).
- Pas de webhooks avancés complexes en premier jet.
- Pas de feature flags premium dispersés dans tous les composants.
- Pas de logique d’accès calculée côté client seulement.

## Plan d’exécution V1 prêt à coder (minimal, ordonné, fichier par fichier)

### 1) Backend — fichiers exacts à créer/modifier

#### A. Fichiers à créer

1. `backend/entitlements.py`
   - rôle: source unique de décision d’accès.
   - contenu minimal:
     - `resolve_plan(user_doc) -> "free" | "premium"`
     - `feature_policy(plan, feature) -> {allowed: bool, monthly_limit: int | None}`
     - `check_access_or_raise(...)`
     - `consume_quota_or_raise(...)`

2. `tests/test_entitlements_v1.py`
   - tests unitaires purs pour la policy V1 (sans FastAPI).

3. `tests/test_billing_api_v1.py`
   - tests API des nouveaux endpoints billing.

4. `tests/test_premium_guards_v1.py`
   - tests API sur guards des endpoints OCR/AI/predictions/stats.

#### B. Fichiers à modifier

1. `backend/models.py`
   - ajouter schémas Pydantic V1:
     - `BillingEntitlementsResponse`
     - `BillingUsageResponse`
     - `BillingVerifyRequest`
     - `BillingRestoreResponse`

2. `backend/server.py`
   - imports de `entitlements.py`.
   - ajout routes billing:
     - `GET /api/billing/entitlements`
     - `GET /api/billing/usage`
     - `POST /api/billing/google/verify`
     - `POST /api/billing/restore`
   - injection guards route-level uniquement dans:
     - `ocr_receipt_route`
     - `get_ai_recipes`
     - `get_predictions`
     - `get_monthly_stats`
   - clamp `months` (free=6, premium=24).

3. `backend/alerts.py` (optionnel V1 strict minimum)
   - lors de seed dev user, conserver compatibilité avec nouveaux champs (si initialisés).

### 2) Frontend — fichiers exacts à créer/modifier

#### A. Fichiers à créer

1. `frontend/app/premium.tsx`
   - écran paywall unique réutilisable (modal/full-screen).

2. `frontend/utils/premiumErrors.ts`
   - mapping centralisé API error -> type fonctionnel:
     - `PREMIUM_REQUIRED`
     - `QUOTA_EXCEEDED`

3. `frontend/store/premiumUiStore.ts` (léger)
   - état UI du paywall (`open`, `context`, `feature`, `remaining`).

4. `frontend/utils/billingService.ts`
   - wrapper minimal achat/restauration (sans logique marketing).

#### B. Fichiers à modifier

1. `frontend/store/authStore.ts`
   - enrichir `AuthUser`/state avec:
     - `plan`
     - `entitlements`
     - `usage`
   - ajouter actions:
     - `refreshEntitlements()`
     - `refreshUsage()`

2. `frontend/app/_layout.tsx`
   - au boot + retour login:
     - appeler `refreshEntitlements()` (et éventuellement `refreshUsage()`).
   - monter le paywall global (ou route dédiée).

3. `frontend/app/scan-receipt.tsx`
   - intercepter erreurs premium/quota de `/api/ocr/receipt` -> ouvrir paywall.

4. `frontend/app/(tabs)/stats.tsx`
   - gérer refus accès `predictions` / historique avancé.

5. `frontend/app/settings.tsx`
   - ajouter actions:
     - "Passer Premium"
     - "Restaurer mes achats"
   - restauration -> backend verify/restore -> refresh entitlements.

6. `frontend/store/stockStore.ts` (modif minimale)
   - utilitaire partagé d’interception erreurs API premium/quota pour éviter duplication.

### 3) Ordre recommandé d’implémentation (exécution)

1. **Policy backend d’abord**
   - créer `entitlements.py` + tests unitaires policy.
2. **Routes billing backend**
   - implémenter `billing/entitlements`, `billing/usage`, `billing/google/verify`, `billing/restore`.
3. **Guards backend sur features coûteuses**
   - brancher OCR, AI, predictions, stats/monthly.
4. **Sync frontend auth**
   - `authStore` + `_layout` pour charger droits.
5. **Paywall unique + interception erreurs**
   - `premium.tsx`, `premiumUiStore`, mapping erreurs.
6. **Branchement écrans ciblés**
   - `scan-receipt`, `stats`, `settings`.
7. **QA offline + restore + expiration**
   - valider les cas limites avant release.

### 4) Contrats de données/API V1 à définir

#### A. `GET /api/billing/entitlements` (source de vérité)
```json
{
  "plan": "free",
  "is_premium": false,
  "subscription_status": "inactive",
  "subscription_expires_at": null,
  "features": {
    "ocr_receipt": {"allowed": true, "monthly_limit": 10},
    "ai_recipes": {"allowed": true, "monthly_limit": 5},
    "predictions": {"allowed": false, "monthly_limit": null},
    "stats_advanced": {"allowed": false, "monthly_limit": null}
  },
  "server_time": "2026-03-31T10:00:00Z"
}
```

#### B. `GET /api/billing/usage`
```json
{
  "period": "2026-03",
  "usage": {
    "ocr_receipt": {"used": 4, "limit": 10, "remaining": 6},
    "ai_recipes": {"used": 2, "limit": 5, "remaining": 3}
  }
}
```

#### C. Erreur standard quota/premium
```json
{
  "detail": {
    "code": "QUOTA_EXCEEDED",
    "feature": "ocr_receipt",
    "remaining": 0,
    "reset_at": "2026-04-01T00:00:00Z"
  }
}
```

```json
{
  "detail": {
    "code": "PREMIUM_REQUIRED",
    "feature": "predictions"
  }
}
```

#### D. `POST /api/billing/google/verify`
- input minimal:
```json
{
  "platform": "android",
  "product_id": "premium_monthly",
  "purchase_token": "xxxx"
}
```
- output minimal:
```json
{
  "ok": true,
  "plan": "premium",
  "subscription_status": "active",
  "subscription_expires_at": "2026-04-30T10:00:00Z"
}
```

### 5) Comportement attendu (scénarios)

1. **Utilisateur free**
   - accès features free.
   - quotas OCR/IA consommés côté backend.
   - UI affiche quotas restants.

2. **Utilisateur premium**
   - accès features premium.
   - quotas premium (élevés/illimités) appliqués côté backend.

3. **Quota dépassé**
   - backend renvoie `QUOTA_EXCEEDED`.
   - frontend ouvre paywall unique avec contexte feature + reset.

4. **Restauration d’achat**
   - settings -> restore -> backend verify/restore.
   - backend met à jour plan.
   - frontend refresh entitlements et ferme paywall.

5. **Expiration abonnement**
   - backend calcule plan=free (source de vérité).
   - prochain refresh entitlements côté app rétrograde l’accès.

6. **Mode hors ligne**
   - aucun unlock premium local permanent.
   - si entitlements cache expiré et action premium: bloquer proprement jusqu’au resync.

### 6) Structure du paywall unique réutilisable (V1)

#### Composant unique
- écran: `frontend/app/premium.tsx`
- props/contexte:
  - `feature` (`ocr_receipt`, `ai_recipes`, `predictions`, `stats_advanced`)
  - `reason` (`premium_required` | `quota_exceeded`)
  - `remaining`, `reset_at` (optionnel)

#### Sections UI fixes
1. titre + bénéfice principal.
2. bloc "Votre statut actuel" (free + quota restant).
3. bloc "Premium mensuel" (1 seule offre).
4. boutons:
   - "S’abonner"
   - "Restaurer mes achats"
   - "Plus tard"

#### Règle d’usage
- aucun autre écran ne réimplémente la logique paywall:
  - on ouvre ce composant via `premiumUiStore`.

### 7) Tests minimaux à écrire pour sécuriser la V1

#### Backend
1. `test_entitlements_v1.py`
   - policy free/premium par feature.
   - gestion expiration abonnement.
2. `test_premium_guards_v1.py`
   - OCR/AI: free sous quota OK, au-delà `QUOTA_EXCEEDED`.
   - predictions free -> `PREMIUM_REQUIRED`.
   - stats/monthly free clamp 6.
3. `test_billing_api_v1.py`
   - verify met à jour plan premium.
   - restore idempotent.
   - entitlements/usage cohérents.

#### Frontend (minimum utile)
1. test mapping `premiumErrors.ts`.
2. test store `authStore.refreshEntitlements`.
3. test ouverture `premiumUiStore` sur erreurs API simulées.
4. test smoke paywall (render + boutons subscribe/restore).
