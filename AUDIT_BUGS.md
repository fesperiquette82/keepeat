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
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` (3193) |
| **Détecté** | 2026-04-10 |

**Constat**
- La docstring de `get_ai_recipes` mentionne "GPT-4o-mini" alors que l'implémentation appelle Gemini (`generativelanguage.googleapis.com`).

**Impact**
- Dette de maintenance, confusion incident/debug.

**Recommandation**
- Mettre à jour docstring + docs associées pour refléter le provider réel.

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
