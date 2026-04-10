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
| **Statut** | `OUVERT` |
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
| **Statut** | `OUVERT` |
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
| **Statut** | `OUVERT` |
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
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` ~lignes 2509 et 3657 |
| **Détecté** | 2026-04-09 |

**Problème :**
Deux fonctions `admin_add_recipe` décorées avec `@api_router.post("/admin/recipes")`. En FastAPI/Starlette, les deux routes sont enregistrées mais la seconde définition Python écrase la première. Comportement non déterministe selon le worker Uvicorn.

Les deux implémentations ont une sémantique différente :
- 1ère (ligne 2509) : `update_one` avec `upsert=True`, ID fourni par le client
- 2ème (ligne 3657) : `insert_one` avec ID généré server-side (`secrets.token_hex(4)`)

**Impact :** L'API admin d'ajout de recettes est instable.

**Correction attendue :** Supprimer la première implémentation (ligne 2509) ou la fusionner avec la seconde.

---

## Bugs MAJEURS

### BUG-003 — `server.py` : `response: Response = None` → headers debug jamais envoyés

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
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
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` ~ligne 2304 |
| **Détecté** | 2026-04-09 |

**Problème :**
```python
scored.sort(
    key=lambda r: (..., -r.get("duration_min", 0)),
    reverse=True,
)
```
`-duration_min` avec `reverse=True` → les valeurs négatives les plus petites (= durées les plus longues) remontent en tête. Contraire à l'intention anti-gaspi.

**Correction attendue :** Retirer la négation ou retirer `reverse=True` pour ce critère.

---

### BUG-016 — Incohérence filtre `stock` vs `all` entre deux utilitaires frontend

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `frontend/utils/recipesFilter.ts` et `frontend/store/recipesStore.ts` |
| **Détecté** | 2026-04-09 |

**Problème :**
- `recipesFilter.ts` envoie `'stock'` pour le filtre `stock`
- `recipesStore.ts` envoie `'all'` pour le même filtre

Le backend retourne des résultats différents selon la valeur reçue.

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
| **Statut** | `OUVERT` |
| **Fichier** | `frontend/app/(tabs)/recipes.tsx` ~ligne 136 |
| **Détecté** | 2026-04-09 |

**Problème :** `targetIngredientNames` est un `Set` créé par `useMemo`. Deux `Set` ne sont jamais `===` même à contenu identique → le `useEffect` se déclenche à chaque rendu → appels API en boucle.

**Correction attendue :** Sérialiser le Set : `[...targetIngredientNames].sort().join(',')` comme dépendance.

---

### BUG-033 — `authStore.ts` : logout interrompu si `unregisterPushToken` plante

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `frontend/store/authStore.ts` ~ligne 193 |
| **Détecté** | 2026-04-09 |

**Problème :** Sans try/catch autour de `unregisterPushToken`, une erreur réseau empêche la suppression du token en `SecureStore` → l'utilisateur reste connecté visuellement.

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
| 🔴 CRITIQUE | 4 | 4 | 0 |
| 🟠 MAJEUR | 13 | 13 | 0 |
| 🟡 MINEUR | 14 | 14 | 0 |
| **TOTAL** | **31** | **31** | **0** |

---

*Dernière mise à jour : 2026-04-09*

---

## Audit ciblé du 2026-04-10 — backend (exécution + revue de code)

### 🔴 CRITIQUE

### BUG-2026-04-10-01 — `/api/recipes/suggestions` peut lever une 500 quand `_upsert_recipe_gap` échoue

| Champ | Valeur |
|---|---|
| **Statut** | `OUVERT` |
| **Fichier** | `backend/server.py` (lignes 2204-2258, 2334-2345) |
| **Détecté** | 2026-04-10 |

**Constat**
- Quand aucune recette n'est trouvée, l'endpoint appelle `_upsert_recipe_gap(...)` sans `try/except` autour de l'accès DB.
- En test, un accès Motor hors boucle active provoque `RuntimeError: Event loop is closed`, qui remonte et casse la requête.

**Preuve de reproduction**
- `pytest -q` échoue sur `tests/test_gap_email_notification.py::SuggestLaterFlagTests::test_suggest_later_false_et_recette_presente_quand_openai_reussit` avec stacktrace sur `recipe_gap_requests_col.find_one(...)`.

**Impact**
- Risque de 500 utilisateur sur un flux censé être "graceful fallback" (`suggest_later`).

**Recommandation**
- Isoler la persistance de gap dans un bloc résilient (`except Exception` + log structuré) pour ne jamais interrompre la réponse de suggestions.

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

