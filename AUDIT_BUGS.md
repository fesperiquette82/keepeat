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

**Problème :**
```typescript
onSwipeableOpen={(direction) => {
  if (direction === 'left') {
    handleSwipeAction(item.id, 'thrown');  // ← direction 'left' = swipe vers droite
  } else {
    handleSwipeAction(item.id, 'used');   // ← direction 'right' = swipe vers gauche
  }
}}
```
`direction === 'left'` signifie que le panneau gauche s'est ouvert (i.e. l'utilisateur a glissé **vers la droite**).
Or `renderLeftActions` affiche "Utilisé" (vert), mais le handler exécute `thrown` (jeté).

**Impact :** Glisser à droite marque un produit comme **jeté** au lieu d'**utilisé**, et inversement. Le stock est corrompu silencieusement.

**Correction attendue :**
```typescript
if (direction === 'left') {
  handleSwipeAction(item.id, 'used');    // panneau gauche = "Utilisé"
} else {
  handleSwipeAction(item.id, 'thrown'); // panneau droit = "Jeté"
}
```

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
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` ~ligne 2857 |
| **Détecté** | 2026-04-09 |

**Problème :**
```python
target = today.replace(day=1) - timedelta(days=i * 30)
```
`30 * i` jours ≠ `i` mois. Selon le mois courant, le résultat peut tomber sur le mauvais mois ou créer des doublons dans `month_list`.

**Correction attendue :** Utiliser `dateutil.relativedelta(months=i)`.

---

### BUG-005 — `ocr_service.py` : `IndexError` potentiel sur `.split("```")`

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `backend/ocr_service.py` ligne 83 |
| **Détecté** | 2026-04-09 |

**Problème :**
```python
text = text.split("```")[1]  # IndexError si un seul ``` dans la réponse Gemini
```

**Correction attendue :**
```python
parts = text.split("```")
text = parts[1] if len(parts) > 1 else parts[0]
```

---

### BUG-007 — `recipes_service.py` : race condition sur `append_recipe_to_catalog`

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `backend/recipes_service.py` ~ligne 253 |
| **Détecté** | 2026-04-09 |

**Problème :**
Lecture + modification + écriture du fichier JSON sans aucun verrou. Deux requêtes parallèles peuvent s'écraser mutuellement.

**Correction attendue :** Utiliser `threading.Lock` ou migrer vers MongoDB exclusivement.

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
| **Statut** | `OUVERT` |
| **Fichier** | `frontend/store/recipesStore.ts` ~ligne 122 |
| **Détecté** | 2026-04-09 |

**Problème :**
```typescript
const filtersToScan: RecipesFilter[] = ['expiryDay', 'expiryWeek', 'expiryMonth', 'stock'];
for (const filter of filtersToScan) {
  const recipes = await get().fetchSuggestions(filter); // jusqu'à 4 appels séquentiels
  ...
}
```
L'endpoint `GET /api/recipes/:id` existe dans `recipesApi.ts` mais n'est pas utilisé ici (BUG-020).

---

### BUG-020 — `recipesApi.ts` : `fetchRecipeById` existant mais non utilisé dans le store

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `frontend/utils/recipesApi.ts` ~ligne 48 |
| **Détecté** | 2026-04-09 |

**Problème :** Endpoint direct disponible mais ignoré. Lié à BUG-019.

---

### BUG-023 — `stockStore.ts` : mutation `updateItem` perdue sur erreur réseau

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `frontend/store/stockStore.ts` ~ligne 576 |
| **Détecté** | 2026-04-09 |

**Problème :** Contrairement à `markConsumed`/`markThrown` qui mettent en queue offline, `updateItem` perd silencieusement la mutation en cas d'erreur réseau.

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
| BUG-006 | `OUVERT` | `backend/recipes_service.py` | `SuggestionStyle` utilisé avant sa définition (ligne 772 vs 516) |
| BUG-008 | `OUVERT` | `backend/server.py` | Cache `_ai_recipe_cache` non partagé entre workers Uvicorn |
| BUG-011 | `OUVERT` | `backend/server.py` | `update_stock` : `find_one` post-update sans filtre `user_id` |
| BUG-012 | `OUVERT` | `backend/server.py` | `get_stock` : limite codée en dur à 1000 items, pas de pagination |
| BUG-013 | `OUVERT` | `backend/server.py` | Log `"source": "openai"` alors que le provider est Gemini |
| BUG-014 | `OUVERT` | `ocr_service.py` + `server.py` | `SHELF_BY_CATEGORY` dupliqué dans 2 fichiers |
| BUG-015 | `OUVERT` | `backend/server.py` | Docstring mentionne "GPT-4o-mini" (vestige migration Gemini) |
| BUG-022 | `OUVERT` | `frontend/store/stockStore.ts` | `useStockStore.getState()` au lieu de `get()` dans une action du store |
| BUG-024 | `OUVERT` | `frontend/app/(tabs)/recipes.tsx` | `scopedRecipesBeforeDedupe` calculé deux fois inutilement |
| BUG-026 | `OUVERT` | `frontend/app/add-product.tsx` | `handleDurationApply` : pas de feedback si valeur ≤ 0 |
| BUG-027 | `OUVERT` | `frontend/app/add-product.tsx` | `lookupProduct` sans cleanup → setState sur composant démonté |
| BUG-028 | `OUVERT` | `frontend/store/stockStore.ts` | `storageZone` absent du type `StockItem` backend |
| BUG-030 | `OUVERT` | `backend/server.py` | `admin_dedup_recipes` : tri lexicographique ≠ ordre de création |
| BUG-031 | `OUVERT` | `backend/server.py` | `_RECEIPT_PROMPT` code mort (dupliqué depuis `ocr_service.py`) |

---

## Bugs déjà corrigés dans cette session

| ID | Fichier | Description | Date correction |
|---|---|---|---|
| — | `frontend/app/scan-receipt.tsx` | Fonction `shelfHint` appelée mais non définie | 2026-04-09 |
| — | `backend/server.py` | `_require_admin` → `_require_admin_user` (4 routes tickets de caisse) | 2026-04-09 |

---

## Tableau de bord

| Sévérité | Total | Ouverts | Corrigés |
|---|---|---|---|
| 🔴 CRITIQUE | 4 | 0 | 4 |
| 🟠 MAJEUR | 13 | 9 | 4 |
| 🟡 MINEUR | 14 | 14 | 0 |
| **TOTAL** | **31** | **23** | **8** |

---

*Dernière mise à jour : 2026-04-14*

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
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` (2318-2323, 3204-3206), `tests/test_premium_guards_v1.py`, `tests/test_gap_email_notification.py` |
| **Détecté** | 2026-04-10 |

**Constat**
- Le backend ne lit plus que `GEMINI_RECIPES_API_KEY`.
- Les tests de non-régression et la documentation de test patchent encore `KEEPEAT_OPENAI_TOKEN`.
- Résultat: des chemins métier attendus (quota, erreurs 502) ne sont plus atteignables et tombent en 503 "IA non configurée".

**Preuve de reproduction**
- `tests/test_premium_guards_v1.py::{test_ai_empty_stock_does_not_consume_quota,test_ai_openai_error_does_not_consume_quota,test_ai_quota_exceeded_returns_standard_error}` en échec.

**Impact**
- Contrat API/ops ambigu (configuration prod + tests CI), faux positifs de monitoring, régressions silencieuses.

**Recommandation**
- Soit supporter les 2 variables avec priorité claire + dépréciation, soit migrer l'ensemble des tests/docs/ops dans le même PR atomique.

---

### BUG-2026-04-10-03 — `_upsert_recipe_gap` appelé dans un scénario où une recette IA est attendue

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` (2317-2345), `tests/test_gap_email_notification.py` |
| **Détecté** | 2026-04-10 |

**Constat**
- La non-disponibilité de la clé Gemini fait basculer immédiatement vers `if not relevant:` puis `_upsert_recipe_gap(...)`.
- Le test `test_upsert_gap_non_appele_quand_openai_reussit` attend l'inverse et échoue.

**Impact**
- Augmentation de bruit dans `recipe_gap_requests` + e-mails inutiles, même quand le flux IA devrait répondre.

**Recommandation**
- Clarifier la règle produit: "pas de gap si IA potentiellement disponible" vs "gap immédiat sans clé".
- Aligner code + tests + documentation sur une seule sémantique.

---

### BUG-2026-04-10-04 — Condition de concurrence possible sur la signature de gap

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` (527, 2228-2257) |
| **Détecté** | 2026-04-10 |

**Constat**
- Le flux fait `find_one(signature)` puis `insert_one(doc)`.
- Avec l'index unique sur `signature`, deux requêtes concurrentes peuvent déclencher un `DuplicateKeyError` non géré.

**Impact**
- 500 intermittentes en charge (difficiles à reproduire localement, coûteuses en prod).

**Recommandation**
- Remplacer le pattern par un `update_one(..., upsert=True)` atomique + gestion explicite du résultat.

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
