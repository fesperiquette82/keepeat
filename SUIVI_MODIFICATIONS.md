# Suivi des modifications — KeepEat

---

## Session du 2026-02-27

### Analyse initiale

Analyse complète du projet (frontend React Native/Expo + backend FastAPI/MongoDB).
Problèmes identifiés dans 5 domaines.

---

### Corrections appliquées

#### 1. Performances — `frontend/store/stockStore.ts`

**Problème :** Après chaque mutation (`markConsumed`, `markThrown`, `addItem`, `updateItem`),
3 appels API étaient lancés séquentiellement.

**Corrections :**
- `markConsumed` / `markThrown` : mise à jour optimiste locale immédiate (retrait de l'item du state,
  ajustement des stats), puis appels en parallèle via `Promise.all`. Rollback sur erreur réseau.
- `addItem` / `updateItem` : les 3 fetches de rafraîchissement passent en `Promise.all`.

---

#### 2. Performance backend — `backend/server.py`

**Problème :** La route `GET /api/stock/priority` chargeait jusqu'à 2000 documents en mémoire Python
pour filtrer les items expirant dans ≤ 3 jours.

**Correction :** Filtre MongoDB natif sur `expiry_date` avec tri côté base de données.
```python
threshold = (_utc_now().date() + timedelta(days=3)).strftime("%Y-%m-%d")
cursor = stock_col.find({
    "status": "active",
    "expiry_date": {"$nin": [None, ""], "$lte": threshold},
}).sort("expiry_date", 1)
```

---

#### 3. Bug timezone OCR — `frontend/app/add-product.tsx`

**Problème :** `new Date("2025-03-15")` parse en UTC → décalage d'1 jour en UTC+1 (France).
La date affichée pouvait être le 14 mars au lieu du 15.

**Correction :** Parse manuel des composants pour rester en heure locale.
```typescript
const parts = dateStr.split('-').map(Number);
const parsed = new Date(parts[0], parts[1] - 1, parts[2]);
```

---

#### 4. Priorité OCR inversée — `frontend/app/add-product.tsx`

**Problème :** La date parsée par le backend (EasyOCR + regex) était utilisée en **dernier recours**,
après deux tentatives de re-parse côté frontend sur le texte brut.

**Correction :** Ordre inversé :
1. Date backend en priorité 1 (déjà parsée avec confiance)
2. Re-parse frontend en fallback uniquement si le backend n'a rien trouvé

---

#### 5. Composants modaux imbriqués — `frontend/app/add-product.tsx`

**Problème :** `DatePickerModal` et `CameraModal` étaient définis à l'intérieur du composant parent.
React créait une nouvelle référence à chaque render → démontage/remontage des modals.

**Correction :** Extraction en composants top-level avec `React.memo` et passage de props.
Ajout d'un `useEffect` dans `DatePickerModal` pour synchroniser l'état interne à l'ouverture.

---

#### 6. Validation `DatePickerModal` — `frontend/app/add-product.tsx`

**Problème :**
- Année minimum codée en dur (`y >= 2024`)
- Pas de vérification de débordement (ex: `31 février` → JavaScript retourne `3 mars` silencieusement)

**Correction :**
```typescript
const newDate = new Date(y, m - 1, d);
if (
  newDate.getFullYear() === y &&
  newDate.getMonth() === m - 1 &&
  newDate.getDate() === d &&
  y >= new Date().getFullYear()
)
```

---

#### 7. Pattern regex trop permissif — `frontend/utils/dateParser.ts`

**Problème :** Le pattern de `tryMonthYear` acceptait un séparateur optionnel (zéro ou plus),
ce qui pouvait générer des faux positifs (ex: `"lot25"` matchait comme `lot` + année 25).

**Correction :** Séparateur rendu obligatoire + lookahead pour éviter les correspondances partielles.
```typescript
// Avant
/([a-z]{3,})\s*[\/\-\.\s]*(\d{2,4})/i
// Après
/([a-z]{3,})[\s\/\-\.]+(\d{2,4})(?!\d)/i
```

---

### Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| `backend/server.py` | Fix performance route `/stock/priority` |
| `frontend/store/stockStore.ts` | Optimistic updates + `Promise.all` |
| `frontend/app/add-product.tsx` | Fix timezone, priorité OCR, modals top-level, validation |
| `frontend/utils/dateParser.ts` | Fix pattern `tryMonthYear` |

---

### Message de commit associé

```
fix: performance, OCR date scan et fiabilité du stock

Frontend (stockStore):
- Optimistic update sur markConsumed/markThrown (retrait immédiat + rollback)
- Fetches de rafraîchissement en parallèle (Promise.all) sur toutes les mutations

Frontend (add-product):
- Correction bug timezone dans tryApplyBackendDate (new Date("YYYY-MM-DD") → heure locale)
- Priorité OCR : date backend utilisée en premier, re-parse frontend en fallback
- DatePickerModal et CameraModal extraits en composants top-level (React.memo)
- Validation DatePickerModal : année dynamique + vérification overflow de date

Frontend (dateParser):
- Pattern tryMonthYear resserré : séparateur obligatoire + lookahead anti-chiffre

Backend (server.py):
- Route /stock/priority : filtre MongoDB natif sur expiry_date
  au lieu de charger 2000 documents en mémoire
```

---

### Problèmes identifiés non corrigés (à traiter)

| # | Problème | Fichier | Priorité |
|---|----------|---------|----------|
| A | CORS `allow_origins=["*"]` en production | `backend/server.py` | Moyenne |
| B | `loadLanguage` non appelé au démarrage | `frontend/app/_layout.tsx` | Basse |
| C | `on_event("shutdown")` déprécié (→ `lifespan`) | `backend/server.py` | Basse |
| D | `get_stats` charge encore 2000 docs en mémoire | `backend/server.py` | Moyenne |
| E | Debug OCR visible en production (`ocrDebug`) | `frontend/app/add-product.tsx` | Basse |
