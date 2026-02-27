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

---

## Session du 2026-02-27 (suite)

### Problèmes traités

#### 8. Cold start Render + latence scan code-barres — `frontend/app/_layout.tsx`

**Problème :** Le backend Render (free tier) se met en veille après ~15 min d'inactivité.
La première requête (scan code-barres) payait 30–60 s de cold start.

**Correction :** Warm-up ping `/health` au démarrage de l'app (best-effort, silencieux).
```typescript
async function warmUpBackend(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    await fetch(`${API_URL}/health`, { signal: controller.signal });
  } catch { } finally { clearTimeout(timer); }
}
// useEffect(() => { warmUpBackend(); }, []);
```

---

#### 9. Latence OCR premier appel + `on_event("shutdown")` déprécié — `backend/server.py`

**Problème :** `easyocr.Reader(["fr","en"])` charge ~500 MB de modèles au **premier** appel OCR,
provoquant un timeout ou OOM sur Render free (512 MB RAM). De plus `@app.on_event("shutdown")`
est déprécié depuis FastAPI 0.93.

**Correction :** Migration vers `lifespan` (contexte async) qui :
1. Pré-charge le modèle OCR au démarrage via `run_in_executor` (non bloquant)
2. Ferme la connexion MongoDB au shutdown
3. Supprime le `@app.on_event` déprécié (règle aussi l'issue C)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, _get_ocr_reader)
    except Exception as e:
        logger.warning("OCR reader pre-initialization failed: %s", e)
    yield
    client.close()

app = FastAPI(title="KeepEat Backend", version="1.0.0", lifespan=lifespan)
```

Timeout OpenFoodFacts réduit de **10 s → 5 s** (limite les blocages sur code-barres inconnus).

---

#### 10. Diagnostic OCR opaque — `frontend/app/add-product.tsx`

**Problème :** `performOCR` retournait `null` pour toute erreur (501, 5xx, timeout réseau),
affichant toujours "OCR indisponible pour le moment" sans indication sur la cause.

**Correction :** Type discriminé `OCRResult` avec 3 raisons d'échec distinctes.

```typescript
type OCRResult =
  | { ok: true; data: OCRResponse }
  | { ok: false; reason: 'not_available' | 'server_error' | 'network_error'; status?: number };
```

| Code retour | Message affiché |
|-------------|-----------------|
| HTTP 501 | "OCR non disponible sur ce serveur." |
| HTTP 5xx | "Erreur serveur OCR (503). Réessayez dans un moment." |
| Timeout / réseau | "Connexion impossible… (le serveur démarre peut-être)." |

Ajout d'un `AbortController` avec timeout 30 s sur la requête OCR.

---

### Fichiers modifiés (session suite)

| Fichier | Nature |
|---------|--------|
| `backend/server.py` | lifespan + pré-init OCR + timeout OFF 5 s + suppression on_event |
| `frontend/app/_layout.tsx` | Warm-up ping au démarrage |
| `frontend/app/add-product.tsx` | Diagnostic OCR différencié (type OCRResult) |

---

### Message de commit associé

```
fix: cold start, latence OCR et diagnostic d'erreur

Backend (server.py):
- Migration on_event("shutdown") → lifespan (FastAPI moderne)
- Pré-chargement du modèle EasyOCR au démarrage via run_in_executor
  (évite timeout/OOM au premier appel OCR)
- Timeout OpenFoodFacts réduit de 10 s à 5 s

Frontend (_layout.tsx):
- Warm-up ping /health au démarrage de l'app
  (réveille le serveur Render avant le premier scan)

Frontend (add-product.tsx):
- Type OCRResult discriminé : not_available / server_error / network_error
- Messages d'erreur distincts selon la cause (501, 5xx, réseau/timeout)
- AbortController avec timeout 30 s sur la requête OCR
```

---

### Problèmes identifiés non corrigés (à traiter)

| # | Problème | Fichier | Priorité |
|---|----------|---------|----------|
| A | CORS `allow_origins=["*"]` en production | `backend/server.py` | Moyenne |
| ~~B~~ | ~~`loadLanguage` non appelé au démarrage~~ | ~~`frontend/app/_layout.tsx`~~ | ~~Basse~~ — **Corrigé (session multiple_usr)** |
| D | `get_stats` charge encore 2000 docs en mémoire | `backend/server.py` | Moyenne |
| E | Debug OCR visible en production (`ocrDebug`) | `frontend/app/add-product.tsx` | Basse |

---

---

## Session du 2026-02-27 — branche `multiple_usr`

### Objectif

Ajout de la gestion des comptes utilisateurs : inscription, connexion, déconnexion,
isolation du stock par utilisateur, et flag `is_premium` activable manuellement.

---

### Nouvelles fonctionnalités

#### 11. Authentification JWT — `backend/server.py`

**Ajouts :**
- Collection MongoDB `users` avec champs `email`, `hashed_password`, `is_premium`, `created_at`, `last_login`
- Hachage bcrypt via `passlib.CryptContext`
- Tokens JWT HS256 (expiration 30 jours) via `python-jose`
- Helper `_get_current_user` : dépendance FastAPI (`Depends`) extraite du header `Authorization: Bearer`

**Routes ajoutées :**
```
POST /api/auth/register  → crée un compte, retourne token + user
POST /api/auth/login     → authentifie, retourne token + user
GET  /api/auth/me        → retourne l'utilisateur courant (auth requise)
PUT  /api/admin/users/{email}/set-premium?key=ADMIN_KEY&premium=true
```

**Variables d'env à ajouter sur Render :**
| Variable | Description |
|----------|-------------|
| `JWT_SECRET_KEY` | Clé secrète JWT (ex: `openssl rand -hex 32`) |
| `ADMIN_KEY` | Clé admin pour activer `is_premium` |

---

#### 12. Isolation du stock par utilisateur — `backend/server.py`

**Toutes les routes stock** (`GET /api/stock`, `POST /api/stock`, `PUT /api/stock/:id`,
`POST /api/stock/:id/consume`, `POST /api/stock/:id/throw`, `GET /api/stock/priority`,
`GET /api/stats`) reçoivent désormais `current_user = Depends(_get_current_user)`.

- Lecture : filtre `{"user_id": current_user["id"], ...}`
- Écriture : injection `doc["user_id"] = current_user["id"]`

Les routes `/api/product/{barcode}`, `/api/ocr/date` et `/health` restent publiques.

---

#### 13. Store auth frontend — `frontend/store/authStore.ts` *(nouveau fichier)*

Zustand store avec persistance sécurisée :
- Token JWT → `expo-secure-store` (Keychain iOS / EncryptedSharedPreferences Android)
- Objet user → `AsyncStorage` (non sensible)

```typescript
interface AuthUser { id: string; email: string; is_premium: boolean; }
interface AuthStore {
  user: AuthUser | null;  token: string | null;  isLoaded: boolean;
  loadAuth: () => Promise<void>;
  login: (email, password) => Promise<void>;
  register: (email, password) => Promise<void>;
  logout: () => Promise<void>;
}
```

---

#### 14. Écrans connexion / inscription — `frontend/app/login.tsx` + `register.tsx` *(nouveaux)*

- `login.tsx` : email + mot de passe, affichage erreur inline, lien vers register
- `register.tsx` : email + mdp + confirmation, validation côté client
  (format email, min 6 chars, correspondance), lien vers login
- Style cohérent (fond `#0a0a0a`, vert `#22c55e`)

---

#### 15. Guard auth — `frontend/app/_layout.tsx`

- `loadAuth()` + `loadLanguage()` appelés au démarrage (corrige issue B)
- Effet de navigation :
  - Non connecté hors auth-group → redirect `/login`
  - Connecté sur login/register → redirect `/`
- Typage TS : `segments[0] as string | undefined` + `router.replace('/login' as any)`
  (routes typées mises à jour après build Expo)

---

#### 16. Header Authorization sur les appels stock — `frontend/store/stockStore.ts`

```typescript
const authHeaders = () => {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
```

Toutes les méthodes `axios.get/post/put` transmettent désormais ce header.
La route `lookupProduct` reste sans auth (route publique).

---

#### 17. Section compte dans les réglages — `frontend/app/settings.tsx`

Nouvelle section "Compte" affichée uniquement si `user !== null` :
- Email de l'utilisateur
- Badge **Premium** (étoile or) ou **Gratuit** (étoile outline grise)
- Bouton "Se déconnecter" avec confirmation `Alert` → `authStore.logout()`

---

### Fichiers modifiés / créés

| Fichier | Nature |
|---------|--------|
| `backend/server.py` | Routes auth, helpers JWT/bcrypt, isolation stock par user_id |
| `frontend/store/authStore.ts` | **Nouveau** — store Zustand + SecureStore |
| `frontend/app/login.tsx` | **Nouveau** — écran connexion |
| `frontend/app/register.tsx` | **Nouveau** — écran inscription |
| `frontend/app/_layout.tsx` | Guard auth + loadAuth + loadLanguage au démarrage |
| `frontend/store/stockStore.ts` | Header Authorization sur tous les appels axios |
| `frontend/app/settings.tsx` | Section compte (email, badge premium, déconnexion) |

**Dépendance ajoutée :**
```bash
cd frontend && npx expo install expo-secure-store
```

---

### Actions requises avant déploiement

1. Ajouter les variables d'env sur Render :
   - `JWT_SECRET_KEY` (générer avec `openssl rand -hex 32`)
   - `ADMIN_KEY` (valeur secrète au choix)
2. Activer `is_premium` via : `PUT /api/admin/users/<email>/set-premium?key=<ADMIN_KEY>&premium=true`

---

### Message de commit associé

```
feat: gestion des comptes utilisateurs et isolation du stock

Backend (server.py):
- Authentification JWT (python-jose, HS256, 30 jours)
- Hachage bcrypt des mots de passe (passlib)
- Routes POST /api/auth/register et /login, GET /api/auth/me
- Route admin PUT /api/admin/users/{email}/set-premium
- Isolation du stock : toutes les routes filtrées/injectées par user_id
- Dépendance _get_current_user via HTTPBearer + Depends()

Frontend (authStore.ts) — nouveau:
- Store Zustand : login / register / logout / loadAuth
- Token JWT dans expo-secure-store (Keychain / EncryptedSharedPreferences)
- Objet user dans AsyncStorage

Frontend (login.tsx / register.tsx) — nouveaux:
- Écrans connexion et inscription
- Validation client (format email, min 6 chars, confirmation mdp)

Frontend (_layout.tsx):
- Guard auth : redirect /login si non connecté, redirect / si déjà connecté
- loadAuth() et loadLanguage() appelés au démarrage (fix issue B)

Frontend (stockStore.ts):
- Header Authorization: Bearer <token> sur tous les appels axios

Frontend (settings.tsx):
- Section Compte : email, badge Premium/Gratuit, bouton déconnexion
```
