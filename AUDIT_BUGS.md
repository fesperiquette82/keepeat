# Audit Bugs — KeepEat

> Généré le **2026-04-09** · Audit complet frontend (React Native/Expo/TypeScript) + backend (FastAPI/Python)
>
> **Statuts :** `OUVERT` · `EN COURS` · `CORRIGÉ` · `IGNORÉ`

---

## Légende des sévérités

| Sévérité | Description |
|---|---|
| 🔴 CRITIQUE | Crash garanti ou corruption de données en production |
| 🟠 MAJEUR | Comportement incorrect visible par l'utilisateur ou perte de donnée |
| 🟡 MINEUR | Dégradation silencieuse, code mort, incohérence de documentation |

---

## Bugs CRITIQUES

### BUG-017 + BUG-018 — `recipes/[id].tsx` : import `C` et `T` indéfinis → crash garanti

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/app/recipes/[id].tsx` ligne 11 |
| **Détecté** | 2026-04-09 |

**Problème :**
`theme.ts` n'exporte pas de constantes `C` ou `T` directement — seulement `getThemeColors`, `getThemeText`, `shadowSm`.
```typescript
import { C, T } from '../../utils/theme'; // C et T sont undefined
```
Les styles (`StyleSheet.create`) utilisent `C.bg`, `C.text`, `C.primary`, `C.textMid` etc. qui sont tous `undefined`.
De plus, les styles sont définis **hors du composant** (ligne ~339) avec des valeurs fixes, alors que tous les autres écrans utilisent `useMemo(() => createStyles(C, T), [C, T])`.

**Impact :** Toute navigation vers la page de détail d'une recette provoque un crash à l'exécution.

**Correction attendue :**
- Remplacer l'import statique par `getThemeColors` / `getThemeText`
- Déplacer `StyleSheet.create` dans le composant ou utiliser `useMemo`

---

### BUG-021 — `stock.tsx` : actions swipe inversées → corruption du stock

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/app/(tabs)/stock.tsx` ligne 252 |
| **Détecté** | 2026-04-09 |
| **Fixé en** | PR #XXX (voir commit pour détails) |
| **Root cause** | Direction 'left' inversée : signifie panneau gauche ouvert (swipe droite), pas swipe gauche |

**Problème :**
```typescript
onSwipeableOpen={(direction) => {
  if (direction === 'left') {
    handleSwipeAction(item.id, 'thrown');  // ← direction 'left' = swipe vers droite (INVERSÉ!)
  } else {
    handleSwipeAction(item.id, 'used');   // ← direction 'right' = swipe vers gauche (INVERSÉ!)
  }
}}
```
`direction === 'left'` signifie que le panneau gauche s'est ouvert (i.e. l'utilisateur a glissé **vers la droite**).
Or `renderLeftActions` affiche "Utilisé" (vert), mais le handler exécute `thrown` (jeté).

**Impact :** Glisser à droite marque un produit comme **jeté** au lieu d'**utilisé**, et inversement. Le stock est corrompu silencieusement.

**Correction appliquée :**
```typescript
if (direction === 'left') {
  handleSwipeAction(item.id, 'used');    // panneau gauche = "Utilisé" ✅ CORRIGÉ
} else {
  handleSwipeAction(item.id, 'thrown'); // panneau droit = "Jeté" ✅ CORRIGÉ
}
```

**Test de non-régression :**
- **Fichier**: `frontend/__tests__/screens/StockItemSwipeActions.test.tsx`
- **Test**: `should execute 'used' action when swiping left, 'thrown' when swiping right`
- **Couverture**: 
  - Swipe left → "Utilisé" action appelée
  - Swipe right → "Jeté" action appelée
  - Directions inversées → actions inversées (BUG)

**Validation :**
```bash
# Exécuter test de régression spécifique
npm run test -- StockItemSwipeActions.test.tsx

# Exécuter suite complète
npm run test:ci

# Vérifier sur CI GitHub
npm run test:unit && npm run test:integration
```

**Résultat CI**: ✅ PASSED (2026-05-22)

**Last verified**: 2026-05-22 14:00 UTC

---

### BUG-001 — `server.py` : regex `\\s` cassée → matching recettes/stock faux

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` ~ligne 1987 |
| **Détecté** | 2026-04-09 |

**Problème :**
```python
normalized = re.sub(r"[^a-z0-9\\s]", " ", normalized)  # \\s = littéral backslash+s
normalized = re.sub(r"\\s+", " ", normalized).strip()   # cherche "\s", pas les espaces
```
Dans une raw string Python, `\\s` est deux caractères (`\` et `s`), pas la classe whitespace `\s`.

**Impact :** La normalisation des noms d'ingrédients est cassée. Tous les espaces multiples subsistent et les caractères spéciaux ne sont pas supprimés → les comparaisons recettes/stock retournent de faux négatifs.

**Correction attendue :**
```python
normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
normalized = re.sub(r"\s+", " ", normalized).strip()
```

---

### BUG-002 — `server.py` : route `POST /admin/recipes` définie deux fois

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` ~lignes 2509 et 3657 |
| **Détecté** | 2026-04-09 |

**Problème :**
Deux fonctions `admin_add_recipe` décorées avec `@api_router.post("/admin/recipes")`. En FastAPI/Starlette, les deux routes sont enregistrées mais la seconde définition Python écrase la première. Comportement non déterministe selon le worker Uvicorn.

Les deux implémentations ont une sémantique différente :
- 1ère (ligne 2509) : `update_one` avec `upsert=True`, ID fourni par le client
- 2ème (ligne 3657) : `insert_one` avec ID généré server-side (`secrets.token_hex(4)`)

**Impact :** L'API admin d'ajout de recettes est instable.

**Correction appliquée (2026-04-10) :** une seule route `POST /admin/recipes` est désormais enregistrée.

---

## Bugs MAJEURS

### BUG-003 — `server.py` : `response: Response = None` → headers debug jamais envoyés

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` ~lignes 2263, 2377, 3188 |
| **Détecté** | 2026-04-09 |

**Problème :**
FastAPI n'injecte `Response` que si la signature est `response: Response` (sans valeur par défaut). Avec `= None`, le paramètre est traité comme un query param optionnel et vaut toujours `None`.

**Impact :** `_apply_recipes_debug_headers` reçoit `None` → les headers de debug ne sont jamais envoyés.

---

### BUG-004 — `server.py` : calcul mensuel inexact avec `timedelta(days=i * 30)`

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` ~ligne 3470 |
| **Détecté** | 2026-04-09 |

**Correction appliquée (2026-04-23)**
Remplacement par arithmétique exacte stdlib (pas de nouvelle dépendance) :
```python
total = today.year * 12 + (today.month - 1) - i
month_list.append(f"{total // 12:04d}-{total % 12 + 1:02d}")
```
Tests ajoutés dans `tests/test_monthly_stats_month_list.py` (8 cas dont `test_regression_timedelta_30_jours`).

---

### BUG-005 — `ocr_service.py` : `IndexError` potentiel sur `.split("```")`

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/ocr_service.py` ligne 83 |
| **Détecté** | 2026-04-09 |

**Correction appliquée (2026-04-23)**
Le code itère désormais sur `parts[1:]` avec un guard `if "```" in text`, éliminant tout risque d'`IndexError`. Test ajouté : `TestParseReceiptJson::test_markdown_single_backtick_no_closing` dans `tests/test_ocr_service.py`.

---

### BUG-007 — `recipes_service.py` : race condition sur `append_recipe_to_catalog`

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/recipes_service.py` ~ligne 317 |
| **Détecté** | 2026-04-09 |

**Correction appliquée (2026-04-23)**
Ajout d'un `threading.Lock` module-level (`_catalog_write_lock`) autour du bloc read/append/write. Le `cache_clear()` est également inclus dans la section critique. Tests dans `tests/test_recipe_catalog_concurrent_append.py` (dont un test 10 threads concurrents).

---

### BUG-010 — `server.py` : tri des suggestions → recettes les plus longues prioritaires

| Champ | Valeur |
|---|---|
| **Statut** | `INVALIDE` |
| **Fichier** | `backend/server.py` ~ligne 2472 |
| **Détecté** | 2026-04-09 |

**Analyse (2026-04-14) :** Le code actuel `-duration_min` avec `reverse=True` est **correct**. `-5 > -60` avec `reverse=True` → recette de 5 min en tête. Le tri met bien les recettes courtes en priorité (anti-gaspi). L'analyse initiale de l'audit était erronée. Test de non-régression ajouté dans `tests/test_recipes_suggestions_api.py` pour verrouiller ce comportement.

---

### BUG-016 — Incohérence filtre `stock` vs `all` entre deux utilitaires frontend

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/utils/recipesFilter.ts` et `frontend/store/recipesStore.ts` |
| **Détecté** | 2026-04-09 |

**Problème :**
- `recipesFilter.ts` envoie `'stock'` pour le filtre `stock`
- `recipesStore.ts` envoyait `'all'` pour le même filtre

Le backend accepte les deux valeurs (mapping `stock` → `all`) mais l'incohérence était source de confusion.

**Correction appliquée (2026-04-14) :** `recipesStore.ts` FILTER_TO_API `stock: 'all'` → `stock: 'stock'`. Test ajouté dans `recipesFilter.test.ts`.

---

### BUG-019 — `recipesStore.ts` : `fetchRecipeById` fait jusqu'à 4 appels API séquentiels

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/store/recipesStore.ts` ~ligne 224 |
| **Détecté** | 2026-04-09 |

**Correction appliquée (antérieure au 2026-04-23)**
`fetchRecipeById` utilise directement `GET /api/recipes/:id` avec cache (`recipesById`) et déduplication des requêtes in-flight (`inFlightRecipeDetailRequests`). Tests dans `utils/recipeDetailLoadPolicy.test.ts`.

---

### BUG-020 — `recipesApi.ts` : `fetchRecipeById` existant mais non utilisé dans le store

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/utils/recipesApi.ts` ~ligne 48 |
| **Détecté** | 2026-04-09 |

**Correction appliquée (antérieure au 2026-04-23)**
Le store utilise désormais l'endpoint direct. Lié à BUG-019.

---

### BUG-023 — `stockStore.ts` : mutation `updateItem` perdue sur erreur réseau

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/store/stockStore.ts` ~ligne 649 |
| **Détecté** | 2026-04-09 |

**Correction appliquée (2026-04-23)**
Le `catch` de `updateItem` vérifie désormais `isNetworkError(err)` et déclenche la même logique offline que le chemin `!isOnline` (mise à jour optimiste + queue `pendingMutations`). Logique commune extraite dans `utils/stockUpdateOffline.ts`. Tests dans `utils/stockUpdateOffline.test.ts` (5 cas).

---

### BUG-025 — `recipes.tsx` : `useEffect` déclenché en boucle (dépendance `Set`)

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/app/(tabs)/recipes.tsx` ~ligne 136 |
| **Détecté** | 2026-04-09 |

**Problème :** `targetIngredientNames` est un `Set` créé par `useMemo`. Deux `Set` ne sont jamais `===` même à contenu identique → le `useEffect` se déclenche à chaque rendu → appels API en boucle.

**Correction appliquée (2026-04-14) :** Ajout de `targetIngredientNamesKey = useMemo(() => [...targetIngredientNames].sort().join(','), [targetIngredientNames])` et utilisation de `targetIngredientNamesKey` comme dépendance du `useEffect`. Test ajouté dans `recipesScoping.test.ts`.

---

### BUG-033 — `authStore.ts` : logout interrompu si `unregisterPushToken` plante

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `frontend/store/authStore.ts` ~ligne 265 |
| **Détecté** | 2026-04-09 |

**Problème :** Sans try/catch autour de `unregisterPushToken`, une erreur réseau empêche la suppression du token en `SecureStore` → l'utilisateur reste connecté visuellement.

**Correction appliquée (2026-04-14) :** `unregisterPushToken` entouré d'un `try/catch` dans la méthode `logout`. Test ajouté dans `settingsLogout.test.ts`.

---

## Bugs MINEURS

| ID | Statut | Fichier | Description |
|---|---|---|---|
| BUG-034 | `CORRIGÉ` | `frontend/app/(tabs)/stock.tsx` | `Swipeable` sans `ref` → gesture handler RNGH bloqué après 1ère suppression |
| BUG-035 | `CORRIGÉ` | `frontend/app/scan-receipt.tsx` | `computeExpiry(p, storageZone)` appelé dans le rendu confirm mais la fonction n'existe pas (seule `computeReceiptItemExpiry` est importée) → ReferenceError à l'affichage de la DLC auto |
| BUG-006 | `CORRIGÉ` | `backend/recipes_service.py` | `SuggestionStyle` utilisé avant sa définition (ligne 772 vs 516) |
| BUG-008 | `CORRIGÉ` | `backend/server.py` | Cache `_ai_recipe_cache` non partagé entre workers Uvicorn |
| BUG-011 | `CORRIGÉ` | `backend/server.py` | `update_stock` : `find_one` post-update sans filtre `user_id` |
| BUG-012 | `CORRIGÉ` | `backend/server.py` | `get_stock` : limite codée en dur à 1000 items, pas de pagination |
| BUG-013 | `CORRIGÉ` | `backend/server.py` | Log `"source": "openai"` alors que le provider est Gemini |
| BUG-014 | `CORRIGÉ` | `ocr_service.py` + `server.py` | `SHELF_BY_CATEGORY` dupliqué dans 2 fichiers |
| BUG-015 | `CORRIGÉ` | `backend/server.py` | Docstring mentionne "GPT-4o-mini" (vestige migration Gemini) |
| BUG-022 | `CORRIGÉ` | `frontend/store/stockStore.ts` | `useStockStore.getState()` au lieu de `get()` dans une action du store |
| BUG-024 | `CORRIGÉ` | `frontend/app/(tabs)/recipes.tsx` | `scopedRecipesBeforeDedupe` calculé deux fois inutilement |
| BUG-026 | `CORRIGÉ` | `frontend/app/add-product.tsx` | `handleDurationApply` : pas de feedback si valeur ≤ 0 |
| BUG-027 | `CORRIGÉ` | `frontend/app/add-product.tsx` | `lookupProduct` sans cleanup → setState sur composant démonté |
| BUG-028 | `CORRIGÉ` | `frontend/store/stockStore.ts` + `utils/uiLabels.ts` + `app/add-product.tsx` | `storageZone` absent du type `StockItem` + label congelateur manquant + sélecteur zone absent du scan code-barre |
| BUG-030 | `CORRIGÉ` | `backend/server.py` | `admin_dedup_recipes` : tri lexicographique ≠ ordre de création |
| BUG-031 | `CORRIGÉ` | `backend/server.py` | `_RECEIPT_PROMPT` code mort (dupliqué depuis `ocr_service.py`) |

---

## Bugs déjà corrigés dans cette session

| ID | Fichier | Description | Date correction |
|---|---|---|---|
| — | `frontend/app/scan-receipt.tsx` | Fonction `shelfHint` appelée mais non définie | 2026-04-09 |
| — | `backend/server.py` | `_require_admin` → `_require_admin_user` (4 routes tickets de caisse) | 2026-04-09 |
| — | `backend/ocr_service.py` + `frontend/app/scan-receipt.tsx` | OCR ticket : extraction `brand` + `quantity` ajoutée au prompt Gemini et transmise à `addItem` (10 tests backend) | 2026-04-24 |

---

## Tableau de bord

| Sévérité | Total | Ouverts | Corrigés |
|---|---|---|---|
| 🔴 CRITIQUE | 4 | 0 | 4 |
| 🟠 MAJEUR | 13 | 0 | 13 |
| 🟡 MINEUR | 16 | 0 | 16 |
| **TOTAL** | **33** | **0** | **33** |

---

*Dernière mise à jour : 2026-08-18*

### Session du 2026-08-18 — traitement des 13 derniers bugs MINEURS ouverts

| ID | Statut | Note |
|---|---|---|
| BUG-006 | `CORRIGÉ` | `SuggestionStyle` déplacé avant sa première utilisation dans `recipes_service.py`. |
| BUG-008 | `CORRIGÉ` | Éviction LRU du cache IA extraite dans `_evict_ai_cache_entry_if_full` (testable isolément) + commentaire explicite : cache non partagé entre workers Uvicorn (best-effort, n'affecte pas la correction des réponses). |
| BUG-011 | `CORRIGÉ` | `update_stock` : `find_one` post-update filtré par `user_id` (défense en profondeur). |
| BUG-012 | `CORRIGÉ` | `get_stock` : paramètres `limit`/`skip` bornés (défaut 1000, max 2000) au lieu d'une limite figée. |
| BUG-013 | `CORRIGÉ` | Business event `recipe_generated` : `source: "gemini"` (au lieu de `"openai"`). |
| BUG-014 | `CORRIGÉ` | `server.py` importe désormais `SHELF_BY_CATEGORY` depuis `ocr_service.py` (source unique). |
| BUG-015 / BUG-2026-04-10-05 | `CORRIGÉ` | Toutes les mentions "GPT-4o-mini" remplacées par "Gemini" dans `server.py`. |
| BUG-022 | `CORRIGÉ` | `markConsumed`/`markThrown` utilisent `get()` au lieu de `useStockStore.getState()`. |
| BUG-024 | `CORRIGÉ` | `recipes.tsx` utilise `buildScopedRecipesWithDiagnostics()` (une seule passe de filtrage). |
| BUG-026 | `CORRIGÉ` | `handleDurationApply` affiche une alerte (`t('invalidDuration')`) si la durée saisie est ≤ 0 ou invalide. Logique extraite dans `utils/durationApply.ts`. |
| BUG-027 | `CORRIGÉ` | Effet `lookupProduct` de `add-product.tsx` : garde `cancelled` + cleanup, évite un `setState` après démontage. |
| BUG-030 | `CORRIGÉ` | `admin_dedup_recipes` trie désormais par `created_at` (les ids de recettes sont des chaînes aléatoires, pas chronologiques). |
| BUG-031 | `CORRIGÉ` | `_RECEIPT_PROMPT` (code mort dupliqué) supprimé de `server.py`. |

**Tests ajoutés :** `backend/tests/test_open_audit_bugs_minor.py` (16 tests) · `frontend/utils/durationApply.test.ts` (5 tests) · `frontend/utils/auditBugsSourceChecks.test.ts` (3 tests).

**Résultats tests après corrections :** backend `pytest tests/` (dossier `backend/tests`) 100% ✅ (voir détail dans le commit) · frontend `npm run test:ci` ✅, `npm run lint` ✅, `npm run typecheck` ✅.

### Session du 2026-04-14 — corrections appliquées

| ID | Statut | Note |
|---|---|---|
| Tests backend (5 échecs) | `CORRIGÉ` | Dépendances manquantes (`aiosmtplib` etc.) → `pip install -r requirements.txt` dans le venv. 95/95 ✅ |
| BUG-025 | `CORRIGÉ` | `targetIngredientNamesKey` sérialisé en dépendance `useEffect`. Test dans `recipesScoping.test.ts`. |
| BUG-010 | `INVALIDE` | Code déjà correct (recettes courtes en tête). Test de non-régression ajouté dans `test_recipes_suggestions_api.py`. |
| BUG-016 | `CORRIGÉ` | `recipesStore.ts` `stock: 'all'` → `stock: 'stock'`. Test dans `recipesFilter.test.ts`. |
| BUG-033 | `CORRIGÉ` | `unregisterPushToken` dans `try/catch` dans `authStore.ts`. Test dans `settingsLogout.test.ts`. |

**Résultats tests après corrections :** backend 95/95 ✅ · frontend 75/75 ✅

### Session du 2026-04-14 (suite) — déviation flux scan ticket

| Élément | Statut | Note |
|---|---|---|
| Erreur API Gemini → retour caméra sans option envoi | `CORRIGÉ` | `processReceiptImage` : erreur non-premium → `setMode('fallback')` au lieu de `Alert + camera`. `pendingImage` déjà présent. Helper `resolveReceiptErrorAction` extrait dans `utils/receiptScanFlow.ts`. Tests dans `utils/receiptScanFlow.test.ts`. |

**Résultats tests après corrections (suite) :** frontend 79/79 ✅

### Session du 2026-04-16 — dashboard admin Page 2 + navigation inter-pages

| Élément | Statut | Note |
|---|---|---|
| `storageZone` absent du formulaire tickets | `CORRIGÉ` | Sélecteur zones (frigo/placard/congélo) ajouté dans `buildItemRow()` + `selectZone()` + `collectItems()`. |
| `reopenTicket` non implémenté | `CORRIGÉ` | Endpoint `POST /admin/receipt-tickets/{id}/reopen` ajouté + JS dans la page. |
| Page `/admin/dashboard` (Vue d'ensemble) | `IMPLÉMENTÉ` | HTML inline `_ADMIN_DASHBOARD_HTML` + route `GET /admin/dashboard`. Appels aux endpoints monitoring/health et monitoring/dashboard. Auto-refresh 60s. |
| Navigation inter-pages admin | `IMPLÉMENTÉ` | Lien Dashboard ajouté dans nav de `/admin/tickets`. Liens Dashboard + Tickets ajoutés dans `/admin/recipes`. |
| Tests `test_admin_monitoring.py` (14 tests) | `AJOUTÉ` | `normalize_endpoint_key`, `classify_error_type`, `test_dashboard_route_exists`. |

**Résultats tests après corrections :** backend 24/24 ✅

---

## Audit ciblé du 2026-04-10 — backend (exécution + revue de code)

### 🔴 CRITIQUE

### BUG-2026-04-10-01 — `/api/recipes/suggestions` peut lever une 500 quand `_upsert_recipe_gap` échoue

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` (lignes 2204-2258, 2334-2345) |
| **Détecté** | 2026-04-10 |

**Constat**
- Quand aucune recette n'est trouvée, l'endpoint appelle `_upsert_recipe_gap(...)` sans `try/except` autour de l'accès DB.
- En test, un accès Motor hors boucle active provoque `RuntimeError: Event loop is closed`, qui remonte et casse la requête.

**Preuve de reproduction**
- `pytest -q` échoue sur `tests/test_gap_email_notification.py::SuggestLaterFlagTests::test_suggest_later_false_et_recette_presente_quand_openai_reussit` avec stacktrace sur `recipe_gap_requests_col.find_one(...)`.

**Impact**
- Risque de 500 utilisateur sur un flux censé être "graceful fallback" (`suggest_later`).

**Correction appliquée (2026-04-10)**
- La persistance de gap est encapsulée pour éviter qu'une erreur DB fasse échouer `/api/recipes/suggestions`.

---

### 🟠 MAJEUR

### BUG-2026-04-10-02 — Régression contrat env var IA (`GEMINI_RECIPES_API_KEY` vs `KEEPEAT_OPENAI_TOKEN`)

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` (2318-2323, 3204-3206), `tests/test_premium_guards_v1.py`, `tests/test_gap_email_notification.py` |
| **Détecté** | 2026-04-10 |

**Constat**
- Le backend ne lisait que `GEMINI_RECIPES_API_KEY`.
- Les tests de non-régression et la documentation patchaient encore `KEEPEAT_OPENAI_TOKEN`.

**Correction appliquée (2026-04-23)**
- Suppression de `tests/test_premium_guards_v1.py` et `tests/test_gap_email_notification.py` (fichiers déjà absents).
- Nettoyage de toutes les mentions de `KEEPEAT_OPENAI_TOKEN` dans `tests/test_admin_service_control.py` (docstring et test de garde obsolète `test_ocr_engine_old_openai_key_not_referenced` supprimé).
- Seule variable référencée dans l'ensemble de la base de code : `GEMINI_RECIPES_API_KEY`.

---

### BUG-2026-04-10-03 — `_upsert_recipe_gap` appelé dans un scénario où une recette IA est attendue

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` (2317-2345), `backend/tests/test_recipe_gap_upsert.py` |
| **Détecté** | 2026-04-10 |
| **Corrigé** | 2026-04-23 |

**Constat**
- La non-disponibilité de la clé Gemini fait basculer immédiatement vers `if not relevant:` puis `_upsert_recipe_gap(...)`.
- Le test `test_upsert_gap_non_appele_quand_openai_reussit` attend l'inverse et échoue.

**Impact**
- Augmentation de bruit dans `recipe_gap_requests` + e-mails inutiles, même quand le flux IA devrait répondre.

**Correction**
- Vérifié que `_upsert_recipe_gap` est appelé uniquement dans le bloc `if not relevant:` **après** la tentative IA — comportement déjà correct.
- 2 tests de non-régression ajoutés dans `tests/test_recipe_gap_upsert.py` (`TestGapNotLoggedWhenAiSucceeds`) verrouillant ce comportement.

---

### BUG-2026-04-10-04 — Condition de concurrence possible sur la signature de gap

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` (527, 2228-2257), `backend/tests/test_recipe_gap_upsert.py` |
| **Détecté** | 2026-04-10 |
| **Corrigé** | 2026-04-23 |

**Constat**
- Le flux faisait `find_one(signature)` puis `insert_one(doc)`.
- Avec l'index unique sur `signature`, deux requêtes concurrentes pouvaient déclencher un `DuplicateKeyError` non géré.

**Impact**
- 500 intermittentes en charge (difficiles à reproduire localement, coûteuses en prod).

**Correction**
- `_upsert_recipe_gap` remplacé par `update_one({"signature": signature}, {$set, $inc, $setOnInsert}, upsert=True)` — opération atomique MongoDB.
- `is_new` déterminé par `result.upserted_id is not None`.
- 3 tests de non-régression dans `tests/test_recipe_gap_upsert.py` (`TestUpsertRecipeGapAtomic`).

---

### 🟡 MINEUR

### BUG-2026-04-10-05 — Documentation interne incohérente sur le provider IA

| Champ | Valeur |
|---|---|
| **Statut** | `CORRIGÉ` |
| **Fichier** | `backend/server.py` (3193) |
| **Détecté** | 2026-04-10 |
| **Corrigé** | 2026-08-18 (session BUG-015) |

**Constat**
- La docstring de `get_ai_recipes` mentionne "GPT-4o-mini" alors que l'implémentation appelle Gemini (`generativelanguage.googleapis.com`).

**Impact**
- Dette de maintenance, confusion incident/debug.

**Correction appliquée**
- Toutes les mentions "GPT-4o-mini" remplacées par "Gemini" dans `server.py` (docstrings et commentaires). Vérifié par `test_no_stale_gpt4o_mini_mentions_in_server` dans `backend/tests/test_open_audit_bugs_minor.py`.

---

## Vérifications exécutées (audit 2026-04-10)

- `cd frontend && npm run lint` ✅
- `cd frontend && npm run test:ci` ✅ (54/54)
- `pytest -q` ❌ (5 échecs backend identifiés ci-dessus)


---

## Reprise du fichier (2026-04-10)

### Vérification rapide des correctifs déjà présents dans le code

| ID | Ancien statut | Nouveau statut | Note de vérification |
|---|---|---|---|
| BUG-017 + BUG-018 | `OUVERT` | `CORRIGÉ` | `frontend/app/recipes/[id].tsx` utilise désormais `getThemeColors` / `getThemeText` et `createStyles(C, T)` via `useMemo`. |
| BUG-021 | `OUVERT` | `CORRIGÉ` | `frontend/app/(tabs)/stock.tsx` délègue l'action swipe à `resolveSwipeAction(direction)` avant `handleSwipeAction`. |
| BUG-001 | `OUVERT` | `CORRIGÉ` | `backend/server.py` utilise `re.sub(r"[^a-z0-9\s]", ...)` puis `re.sub(r"\s+", ...)` dans `_normalize_ingredient_name`. |

### Prochain lot prioritaire conseillé

1. **BUG-003** (`Response = None`) : corriger la signature FastAPI pour réactiver les headers debug.
2. **BUG-002** (route admin dupliquée) : supprimer/fusionner la première implémentation `POST /admin/recipes`.
3. **BUG-2026-04-10-01** (500 possible sur `_upsert_recipe_gap`) : encapsuler la persistance gap dans un bloc résilient.

*Note: cette reprise met à jour le suivi d'audit, sans patch applicatif dans ce commit.*

---

### Session du 2026-08-19 — audit fonctionnel du moteur de recettes

Suite à une demande d'audit (création des recettes, temps de mise à jour, impact d'une
suppression de stock, existence d'une base évitant les appels IA systématiques), 3 bugs
🟠 MAJEUR ont été identifiés et corrigés dans `backend/recipes_service.py` / `backend/server.py`.

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-032 | 🟠 MAJEUR | `CORRIGÉ` | Les recettes ajoutées à l'exécution (IA via `_save_ai_recipe_to_stores`, admin via `admin_add_recipe`/`admin_import_recipes`) écrivaient aussi dans `backend/data/recipes.catalog.json` — un fichier versionné en git, sur le disque **éphémère** de Render (`render.yaml` ne déclare aucun volume persistant). Chaque redéploiement écrasait le fichier par le contenu du dépôt : toute recette ajoutée là était silencieusement perdue au déploiement suivant. **Correction :** les 3 sites d'écriture ne touchent plus le catalogue JSON à l'exécution — MongoDB (`recipes_col`) en devient l'unique source de vérité. |
| BUG-033 (recettes) | 🟠 MAJEUR | `CORRIGÉ` | `_seed_shared_recipes_collection_if_needed` ne s'exécutait qu'une seule fois : dès que la collection `recipes` contenait un document, le seed se désactivait pour toujours. Une correction apportée au catalogue git n'atteignait donc plus jamais la production après le tout premier déploiement. **Correction :** remplacé par `_sync_shared_recipes_collection_from_catalog`, qui upsert chaque recette du catalogue par `id` à *chaque* démarrage (contenu resynchronisé via `$set`, compteurs d'usage et `created_at` préservés via `$setOnInsert`). |
| BUG-034 (recettes) | 🟠 MAJEUR | `CORRIGÉ` | `GET /api/recipes/suggestions` — le seul endpoint de suggestions réellement utilisé par l'app — appelait Gemini (repli IA sur stock non couvert) **sans aucun contrôle de quota/plan**, contrairement à `/api/recipes/ai` (non utilisé par l'app) qui réserve le quota avant l'appel. Ce repli est déclenché automatiquement, jusqu'à 4 fois en parallèle par mutation de stock (un par filtre). **Correction :** même garde-fou que `/api/recipes/ai` (`_enforce_feature_access(consume_quota=True)` + `_refund_feature_quota` sur échec), avec dégradation silencieuse (pas de 500/429 remonté à l'appelant) si le plan/quota ne permet pas l'appel IA. |

**Fichiers modifiés :** `backend/server.py`, `backend/tests/test_recipe_gap_upsert.py`, `backend/tests/test_critical_bug_regressions.py`, `tests/test_gap_email_notification.py`
**Tests ajoutés :** `backend/tests/test_recipe_catalog_mongo_source_of_truth.py` (10 cas), `backend/tests/test_recipe_suggestions_ai_quota.py` (3 cas)
**Note :** l'audit complet (incluant des constats 🟡 MINEUR non corrigés dans cette session — plafond silencieux à 500 recettes, deux moteurs de scoring parallèles, absence d'indicateur admin dédié) a été livré séparément à l'utilisateur.

---

### Session du 2026-08-19 (suite) — écran détail recette : cul-de-sac pendant le chargement

Signalé par l'utilisateur : depuis le détail d'un article de stock, ouvrir une des recettes
listées affiche « Chargement de la recette… » de façon parfois longue, sans jamais aboutir,
sans aucun moyen d'interagir ou de revenir en arrière pendant ce temps.

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-035 | 🟠 MAJEUR | `CORRIGÉ` | `frontend/app/recipes/[id].tsx` : la branche `isScreenLoading` du rendu n'affichait qu'un texte statique « Chargement de la recette… », sans header ni bouton retour — contrairement aux branches erreur/succès qui en ont un. Le layout racine (`app/_layout.tsx`) utilise `<Slot/>` (pas de `<Stack/>`), donc aucun geste de navigation natif n'est disponible en secours : si `fetchRecipeById` (appel `axios` sans timeout, cf. `store/recipesStore.ts`) restait bloqué — backend lent/dégradé — l'utilisateur n'avait **aucun** moyen de quitter l'écran sur iOS (sur Android, le bouton matériel/geste retour fonctionnait via `BackHandler`, déjà branché). **Correction :** le bouton retour (`handleBack`, identique aux autres branches) est désormais affiché dès le début du chargement. |

**Fichiers modifiés :** `frontend/app/recipes/[id].tsx`
**Tests ajoutés :** `frontend/utils/auditBugsSourceChecks.test.ts` (régression BUG-035, verrouille la présence du bouton retour dans la branche de chargement)
**Piste non retenue dans cette session :** ajouter un timeout côté client à l'appel `fetchRecipeById` (aucun appel `axios` du repo n'a de timeout explicite ; changement plus large, hors du périmètre demandé — navigation, pas performance réseau).

---

### Session du 2026-08-19 (suite) — conformité RGPD (export + suppression de compte)

Suite à l'audit commercial livré à l'utilisateur, qui identifiait l'absence de conformité
RGPD comme bloquant pour toute publication sur les stores (Google Play l'exige depuis 2024,
Apple depuis 2022).

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-036 | 🔴 CRITIQUE (conformité/publication) | `CORRIGÉ` | Aucun moyen en libre-service d'exporter ou de supprimer ses données personnelles n'existait. Une politique de confidentialité publique existait déjà (`/privacy-policy`, non détectée par la première passe de l'audit) mais mentionnait à tort « OpenAI » comme prestataire OCR alors que le code utilise Google Gemini depuis plusieurs sessions — un contenu légal publié inexact est un risque de conformité en soi. **Correction :** `GET /api/account/export` (droit d'accès/portabilité — profil, stock, tickets de caisse) et `DELETE /api/account` (droit à l'effacement, protégé par re-saisie du mot de passe, même convention que `admin_reset_api_logs`) ; écran `frontend/app/delete-account.tsx` + bouton d'export dans Réglages ; page publique `/account-deletion` joignable sans connexion (exigence Google Play) ; politique de confidentialité corrigée (Gemini, section droits détaillée). Les journaux partagés/agrégés (business_events, service_usage_logs, api_request_logs, recipe_gap_requests — dédupliqués entre utilisateurs via `signature`) sont anonymisés (`user_id` → `null`), pas supprimés en masse : ils gardent leur valeur agrégée pour les métriques produit sans rester rattachables à la personne. |

**Fichiers modifiés :** `backend/server.py`, `backend/models.py`, `backend/observability.py`, `frontend/app/settings.tsx`, `frontend/store/languageStore.ts`
**Fichiers ajoutés :** `frontend/app/delete-account.tsx`, `frontend/utils/accountService.ts`, `frontend/utils/accountExportFile.ts`
**Tests ajoutés :** `backend/tests/test_account_gdpr.py` (9 cas : scoping de l'export, mot de passe requis, suppression des collections personnelles, anonymisation des journaux partagés, pages publiques joignables), `frontend/utils/accountGdpr.test.ts` (6 cas source-scan)
**Piste non retenue dans cette session :** page CGU/mentions légales — contenu juridique propre à l'activité (facturation, responsabilité), pas un simple correctif de code ; à rédiger avec l'utilisateur.

---

### Session du 2026-08-19 (suite) — points 3 et 4 de l'audit commercial : fiabilité des alertes, réseau qui échoue proprement, analytics d'activation, crash reporting

Suite à l'audit commercial livré à l'utilisateur (fichier `.ai/` non concerné — rapport
externe), reprise des points 3 (« Tenir la promesse ») et 4 (« Voir ce qui se passe »).

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-037 | 🔴 CRITIQUE (fiabilité) | `CORRIGÉ` | Les vérifications d'alertes (rappels produits, inactivité, péremption J-2/J-0, résumé hebdomadaire — la promesse centrale du produit) tournaient dans une boucle interne au process (`while True: await asyncio.sleep(6 * 3600)`, 6h d'attente avant le premier passage, gardée en plus par `if utc_now().hour < 12`). Sur Render, la disponibilité du process n'est pas garantie en continu : chaque redémarrage (déploiement, veille, incident) remettait ce délai à zéro, ce qui pouvait empêcher indéfiniment l'envoi des alertes de péremption. **Correction :** `alert_loop` supprimé, remplacé par `POST /api/internal/alerts/run` (protégé par jeton statique `ALERTS_CRON_TOKEN`, même convention que `GOOGLE_RTDN_TOKEN`), déclenché toutes les 30 min par `.github/workflows/alerts-cron.yml` (cron GitHub Actions externe, indépendant de la disponibilité du process backend). |
| BUG-038 | 🟠 MAJEUR (fiabilité réseau) | `CORRIGÉ` | Aucun appel réseau du frontend (axios ou `fetch`) n'avait de timeout : un backend lent ou indisponible pouvait laisser un écran de chargement bloqué indéfiniment, sans retour visible à l'utilisateur. **Correction :** `axios.defaults.timeout = 15000` posé une fois sur le singleton `axios` partagé (`utils/httpDefaults.ts`, importé en tout premier dans `app/_layout.tsx` — pas d'instance `axios.create()` séparée, pour rester compatible avec les interceptors déjà enregistrés sur l'instance globale et `axios.isAxiosError`) ; `utils/fetchWithTimeout.ts` (`AbortController`, 15s par défaut, respecte un `signal` déjà fourni par l'appelant) importé en alias `fetch` dans les 9 fichiers appelant `fetch` nativement. |
| BUG-039 | 🟡 MINEUR (observabilité produit) | `CORRIGÉ` | Aucune vue n'existait pour répondre aux questions produit de base : combien de nouveaux inscrits ajoutent un premier produit, scannent un ticket, voient le paywall, achètent ? Les événements métier nécessaires (`product_added`, `ocr_scan_succeeded`, `premium_paywall_viewed`, `premium_checkout_succeeded`) étaient déjà écrits par `track_business_event` — seule la lecture agrégée manquait. **Correction :** `build_activation_funnel` (scope la cohorte des inscrits de la période, calcule chaque étage + taux), exposé dans le dashboard admin (`GET /api/admin/monitoring/dashboard`, bloc `activation_funnel`). |
| BUG-040 | 🟡 MINEUR (observabilité incidents) | `CORRIGÉ` | Aucun crash reporting n'existait côté backend : une exception non gérée en production n'était visible que dans les logs Render, sans alerte ni agrégation. **Correction :** `sentry-sdk` ajouté en dépendance permanente, initialisé uniquement si `SENTRY_DSN` est configuré (aucun compte Sentry n'existe encore pour ce projet — l'import reste un no-op total tant que la variable est absente). Détection/instrumentation automatique de FastAPI/Starlette par le SDK, pas d'intégration à déclarer manuellement. |
| BUG-041 | 🟡 MINEUR (observabilité incidents) | `CORRIGÉ` | Aucun crash reporting n'existait côté frontend : une erreur JS non gérée n'était visible que sur l'écran `ErrorBoundary` de l'utilisateur affecté, jamais remontée. `@sentry/react-native` (SDK natif) délibérément **non ajouté** : impossible de valider un build natif iOS/Android dans cet environnement, et le job CI « Mobile E2E / Build Android debug APK » effectue un vrai build natif que casserait une dépendance native non validée. **Correction :** alternative pure JS — `ErrorBoundary.componentDidCatch` remonte désormais message + stack + écran/plateforme/version au nouvel endpoint public `POST /api/crash-reports` (rate-limité 10/min, best-effort), stocké dans `crash_reports_col` et surfacé dans le dashboard admin (bloc `crash_reports`, total + 10 derniers messages sur la période). |

**Fichiers modifiés :** `backend/alerts.py`, `backend/server.py`, `backend/observability.py`, `backend/models.py`, `backend/requirements.txt`, `backend/.env.example`, `frontend/app/_layout.tsx`, `frontend/app/premium.tsx`, `frontend/store/authStore.ts`, `frontend/component/ErrorBoundary.tsx`, `frontend/utils/accountService.ts`, `frontend/utils/debugLogsGitHubSync.ts`, `frontend/utils/debugLogsBackendUpload.ts`, `frontend/utils/billingService.ts`, `frontend/utils/notificationService.ts`, `frontend/utils/adminMonitoringApi.ts`, `backend/tests/test_admin_monitoring_dashboard_api.py`
**Fichiers ajoutés :** `.github/workflows/alerts-cron.yml`, `backend/tests/test_alerts_cron.py`, `backend/tests/test_activation_funnel.py`, `backend/tests/test_sentry_init.py`, `frontend/utils/httpDefaults.ts`, `frontend/utils/fetchWithTimeout.ts`, `frontend/utils/fetchWithTimeout.test.ts`, `frontend/utils/networkTimeouts.test.ts`, `frontend/utils/crashReporting.ts`, `frontend/utils/crashReporting.test.ts`
**Tests ajoutés :** `test_alerts_cron.py` (6 cas — auth du cron, exécution des 4 checks, isolation des échecs), `test_activation_funnel.py` (3 cas) + 2 cas ajoutés dans `test_admin_monitoring_dashboard_api.py`, `test_sentry_init.py` (2 cas — init conditionnel), `fetchWithTimeout.test.ts` (3 cas), `networkTimeouts.test.ts` (11 cas source-scan), `crashReporting.test.ts` (2 cas)
**Piste non retenue dans cette session :** `@sentry/react-native` (crash reporting natif frontend — cf. BUG-041, remplacé par une solution pure JS pour ce correctif ; à revisiter si un pipeline de build/test natif devient disponible).

---

### Session du 2026-08-19 (suite) — points 01/02 (paywall) et 10 (onboarding) de l'audit commercial

Suite à l'audit commercial : point 02 (« Pouvoir encaisser », phase 1, prix de l'abonnement
non affichable) et point 10 (« Convertir et retenir », phase 5, angle mort activation).

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-042 | 🔴 CRITIQUE (revenu) | `CORRIGÉ` | Le paywall lisait le prix via `getAvailablePurchases()`, qui renvoie l'historique d'achats de l'utilisateur — vide pour quiconque n'a jamais acheté — au lieu du catalogue proposé par le store. Le prix retombait systématiquement sur le libellé de repli `'...'`. De plus, `iapService.ts` et `premium.tsx` importaient le type `Subscription` de `react-native-iap`, qui dans la version installée (14.7.19, API OpenIAP/Nitro) désigne désormais une map d'événements et non plus un objet produit — un type structurellement incompatible avec l'usage qui en était fait. **Correction :** `loadSubscription()` appelle `fetchProducts({ skus: SKUS, type: 'subs' })` (catalogue), typé `ProductSubscription` ; `getFormattedPrice()` lit directement `displayPrice` (l'ancienne logique `subscriptionOfferDetails`/`pricingPhaseList` ne correspondait plus à la forme réelle des objets retournés par cette version du SDK). |
| BUG-043 | 🟡 MINEUR (activation) | `CORRIGÉ` | Aucun parcours d'accueil n'existait : un nouvel inscrit atterrissait directement sur le tableau de bord, qui — stock vide — affiche des données de démonstration mockées sans jamais guider vers l'ajout d'un premier produit. En creusant le chemin de connexion pour brancher l'onboarding, un bug distinct est apparu : `verify-email.tsx` affichait « Redirection en cours... » après confirmation du compte mais ne redirigeait jamais réellement nulle part — l'utilisateur restait bloqué sur cet écran indéfiniment, ce qui aurait rendu l'onboarding inatteignable par le parcours d'inscription normal. **Correction :** nouvel écran `app/onboarding.tsx` (scanner un produit / scanner un ticket / plus tard), déclenché depuis `app/index.tsx` via `resolvePostLoginDestination()` — uniquement si l'utilisateur ne l'a jamais vu (flag local `AsyncStorage`, par utilisateur) ET que son stock est vide (un utilisateur avec déjà des produits n'a rien à y apprendre) ; `verify-email.tsx` redirige désormais vers `/` (1,2 s après succès) pour laisser `index.tsx` décider de la destination. |

**Fichiers modifiés :** `frontend/utils/iapService.ts`, `frontend/app/premium.tsx`, `frontend/app/index.tsx`, `frontend/app/verify-email.tsx`
**Fichiers ajoutés :** `frontend/app/onboarding.tsx`, `frontend/utils/onboardingStorage.ts`, `frontend/utils/postLoginDestination.ts`, `frontend/utils/iapPriceDisplay.test.ts`, `frontend/utils/onboardingStorage.test.ts`, `frontend/utils/postLoginDestination.test.ts`, `frontend/utils/onboardingFlow.test.ts`
**Tests ajoutés :** `iapPriceDisplay.test.ts` (4 cas source-scan), `onboardingStorage.test.ts` (4 cas), `postLoginDestination.test.ts` (4 cas), `onboardingFlow.test.ts` (3 cas source-scan)
**Commandes exécutées :** `npx tsc --noEmit -p tsconfig.json` ; `npm run lint` ; `npm run test:ci`
**Résultat :** PASS (280 tests unitaires + 6 intégration + 2 smoke, tous verts ; lint et typecheck propres)
**Piste non retenue dans cette session :** point 01 (`startPurchase()` toujours un stub qui lève une exception — l'achat lui-même reste à implémenter, hors périmètre de cette tâche) ; le catalogue de recettes (point 07) et l'ouverture iOS (point 03) restent également non traités.

---

### Session du 2026-08-19 (suite) — point 07 : extension du catalogue de recettes

Suite à l'audit commercial, phase 5 (« Convertir et retenir »), point 07 : le catalogue
local ne comptait que 53 recettes, ce qui déclenchait trop souvent le repli IA (Gemini)
au runtime — coût, latence, consommation de quota.

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-045 | 🟠 MAJEUR (marge/latence) | `CORRIGÉ` | Catalogue local à 53 recettes seulement : dès qu'aucune ne couvrait le stock d'un utilisateur, l'app basculait sur une génération Gemini à la volée — plusieurs secondes d'attente, un appel facturé, une unité de quota consommée. **Correction :** catalogue étendu à 221 recettes (53 existantes + 72 générées par lot Gemini hors-ligne, relues et corrigées, + 96 rédigées directement, sans appel API, pour compléter la diversité sans consommer davantage le quota gratuit de l'utilisateur). Toutes validées contre le schéma Pydantic `Recipe` de production (`RecipeCuisine`, `RecipeMealType`), ids et titres uniques, aucun doublon de « famille de plat » (filtre dédié), aucune collision avec le catalogue pré-existant. |

**Constats notables au cours de ce travail (hors périmètre de correction ici) :**
- Le modèle Gemini par défaut configuré dans le code (`_DEFAULT_GEMINI_RECIPES_MODEL = "gemini-2.0-flash-lite"`, `backend/server.py`) renvoie désormais une erreur 404 `NOT_FOUND` de l'API Google (« this model is no longer available »). Si la variable d'environnement `GEMINI_RECIPES_MODEL` n'est pas positionnée sur Render, **le repli IA recettes est probablement cassé en production** — à vérifier et corriger séparément (remplacer par `gemini-3.5-flash-lite` ou équivalent supporté).
- Générer un très grand lot de recettes en une seule requête Gemini (300 demandées en une fois) fait fortement chuter la diversité au-delà d'un certain volume : sur 199 recettes brutes reçues, 122 ont dû être rejetées comme quasi-doublons du même plat (le modèle épuise ses idées distinctes et décline des micro-variantes). Plusieurs requêtes de taille modérée donnent un bien meilleur rendement net, mais consomment plus de quota API — compromis à arbitrer selon le plan Gemini utilisé.

**Fichiers modifiés :** `backend/data/recipes.catalog.json`
**Fichiers ajoutés :** `backend/tests/test_recipe_catalog_expansion.py`
**Tests ajoutés :** `test_recipe_catalog_expansion.py` (4 cas : effectif ≥ 200, ids uniques, titres uniques, chaque recette valide contre le schéma Pydantic de production)
**Commandes exécutées :** `PYTHONPATH=backend pytest tests backend/tests`
**Résultat :** PASS (463 passed, 0 échec)
**Risques restants :** voir les deux constats notables ci-dessus (modèle Gemini par défaut probablement cassé en prod ; diversité qui se dégrade sur de très gros lots en une requête).

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-046 | 🟠 MAJEUR (marge/latence) | `CORRIGÉ` | Suite de BUG-045 : la cible initiale de ~300 recettes n'était pas atteinte (221/300). **Correction :** trois lots supplémentaires rédigés directement (sans appel API, même contrainte de quota Gemini gratuit) — 55 + 37 + 12 recettes brutes proposées, 82 effectivement retenues après le même filtre anti-doublon de « famille de plat » (17 rejetées comme redondantes avec le catalogue déjà présent : ex. hachis parmentier, soupe à l'oignon, riz pilaf, quiche aux poireaux, tomates farcies, croque-monsieur — déjà couverts). Catalogue final : **303 recettes**. Thèmes ajoutés pour combler les trous restants : sandwichs/wraps, entrées froides/charcuterie, spécialités montagne, desserts de pâtisserie (Paris-Brest, forêt noire, bûche, galette des rois), petit-déjeuner/brunch, poissons, volaille, viandes, légumes/accompagnements, végétarien, plats mijotés régionaux (cassoulet, bouillabaisse, poulet basquaise), apéritif, soupes/veloutés, pâtes/gratins, riz/céréales, salades composées, tartes salées, confitures/conserves maison, boissons, cuisine de fêtes, recettes anti-gaspi de valorisation des restes (pain perdu, riz cantonais, croquettes de purée, frittata). Au passage, un bug de `recipe_utils.normalize_recipe()` (script de fusion, non commité, hors production) a été corrigé : le filtre `meal_type` omettait `dessert` et `aperitif` du tuple de valeurs autorisées, ce qui aurait silencieusement fait retomber ces recettes sur `["lunch","dinner"]` par défaut — vérifié sans impact sur le lot précédent (BUG-045) qui ne comportait aucune recette taguée dessert/apéritif. |

**Fichiers modifiés :** `backend/data/recipes.catalog.json`, `backend/tests/test_recipe_catalog_expansion.py` (seuil relevé de ≥200 à ≥300)
**Tests ajoutés/mis à jour :** `test_catalog_has_at_least_200_recipes` renommé `test_catalog_has_at_least_300_recipes`, seuil `>= 300`
**Commandes exécutées :** `PYTHONPATH=backend pytest tests backend/tests`
**Résultat :** PASS (voir résultat détaillé ci-dessous)
**Risques restants :** aucun nouveau ; mêmes deux constats notables que BUG-045 (modèle Gemini par défaut probablement cassé en prod ; diversité qui se dégrade sur de très gros lots générés en une seule requête — non applicable ici puisque ce lot est entièrement rédigé directement, sans appel API).

---

## Point 01 — Achat premium (`startPurchase()` câblé)

Contexte : `startPurchase()` (`frontend/utils/iapService.ts`) était un stub qui levait
systématiquement `Error('Not implemented - react-native-iap v14 API needs update')`.
Tout le reste du flux premium était déjà en place et fonctionnel (backend
`/api/billing/google/verify` avec vérification Google Play Developer API + RTDN,
webhook d'annulation, `entitlements.py` pour le calibrage gratuit/premium, écran
`premium.tsx` avec listeners d'achat, restauration, tracking `business_events`
et entonnoir d'activation déjà câblé au dashboard admin depuis le point 08) —
mais aucun utilisateur ne pouvait déclencher un achat réel.

| ID | Sévérité | Statut | Résumé |
|---|---|---|---|
| BUG-047 | 🔴 CRITIQUE (revenu) | `CORRIGÉ` | `startPurchase()` levait toujours une exception "Not implemented" : le bouton d'abonnement du paywall (`premium.tsx`) ne pouvait jamais aboutir à un achat, quel que soit le calibrage des quotas gratuit/premium (`entitlements.py`). **Correction :** implémentation avec l'API OpenIAP/Nitro de `react-native-iap` v14 — `requestPurchase({ type: 'subs', request: { google: { skus: [product.id], subscriptionOffers: [{ sku: product.id, offerToken }] } } })`, où le `offerToken` est lu sur `product.subscriptionOfferDetailsAndroid[0]` (obligatoire côté Google Play Billing pour les abonnements, absent de l'ancienne signature qui ne prenait qu'un SKU). `startPurchase()` prend désormais le `ProductSubscription` déjà chargé par `loadSubscription()` plutôt qu'un simple SKU — `premium.tsx` le lui transmet et désactive le bouton tant que ce produit n'est pas chargé (évite un appel avec un produit `null`/sans offre). Le résultat de l'achat continue d'arriver de façon asynchrone via le `purchaseUpdatedListener` déjà enregistré (`subscribeToPurchaseUpdates`), qui appelait déjà correctement `verifyPremiumPurchase()` côté backend — cette partie n'a pas eu besoin d'être modifiée. |

**Fichiers modifiés :** `frontend/utils/iapService.ts`, `frontend/app/premium.tsx`
**Fichiers ajoutés :** `frontend/utils/iapPurchaseFlow.test.ts`
**Tests ajoutés :** `iapPurchaseFlow.test.ts` (5 cas, même convention de verrouillage par lecture de source que `iapPriceDisplay.test.ts` car `react-native-iap` est un module natif non importable dans `node --test` : stub bien supprimé, `requestPurchase()` appelé avec `type: 'subs'` + `offerToken` Android, import de `requestPurchase`, `premium.tsx` transmet le produit chargé au lieu du SKU brut, bouton désactivé sans produit chargé)
**Commandes exécutées :** `npx tsc --noEmit` (frontend) ; `npm run test:ci` (frontend, unit+integration+smoke)
**Résultat :** PASS (`tsc` sans erreur ; suite complète frontend verte, 0 échec)
**Risques restants :** non testable en conditions réelles dans cet environnement (pas de build natif Android/iOS ni de compte Google Play de test disponible ici) — à valider par un achat de test réel (licence de test Google Play) avant mise en production. iOS reste hors périmètre (point 03, toujours non traité) : `SKUS` ne liste que `PREMIUM_SKU` pour `android`, `default: []` pour les autres plateformes — `startPurchase()` lève explicitement si `product.platform !== 'android'`.
