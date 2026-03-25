# KeepEat

Application mobile anti-gaspillage alimentaire composée d'un backend FastAPI/MongoDB et d'un frontend Expo/React Native.

## Structure

- `backend/` : API FastAPI, logique métier, accès MongoDB, notifications et intégrations externes.
- `backend/data/recipes.catalog.json` : catalogue local des recettes françaises utilisé par le moteur de suggestions.
- `frontend/` : application mobile Expo avec navigation `expo-router`, état global Zustand et synchronisation hors ligne.
- `backend_test.py` : script de smoke tests HTTP pour le backend.

## Prérequis

### Backend

- Python 3.11+
- Une base MongoDB accessible

### Frontend

- Node.js 20+
- npm 10+
- Expo CLI via `npx expo`

## Démarrage rapide

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Créer un fichier `backend/.env` avec au minimum :

```env
MONGO_URL=mongodb://localhost:27017/keepeat
JWT_SECRET=change-me
BACKEND_URL=http://localhost:8000
```

Variables utiles supplémentaires selon les fonctionnalités activées :

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
ADMIN_KEY=
OPENAI_API_KEY=
OPENFOODFACTS_USER_AGENT=KeepEat/1.0 (dev@example.com)
```

Lancer l'API :

```bash
cd backend
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
```

Définir l'URL du backend avant de lancer l'app :

```bash
export EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
```

Puis démarrer Expo :

```bash
cd frontend
npm run start
```

## Vérifications utiles

### Frontend

```bash
cd frontend
npm run lint
```

### Backend

```bash
python -m py_compile backend/server.py backend_test.py
python -m unittest discover -s tests -p 'test_recipes_*.py'
```

### Smoke tests backend

Le script suivant cible `http://localhost:8000` par défaut ; vous pouvez surcharger l'URL avec `KEEPEAT_BASE_URL`.

```bash
python backend_test.py
```

## Warm-up intelligent / éviter les cold starts

Sur Render (et services similaires), un backend inactif peut passer en veille. La première requête utilisateur peut alors être plus lente (cold start).

Approche KeepEat (backend uniquement) :

1. Warm-up au startup FastAPI : préchargement du catalogue local + ping DB léger (défensif, sans crash serveur si échec partiel).
2. Endpoint santé ultra léger : `GET /api/health` retourne rapidement `{"status":"ok"}` (pas de logique métier).
3. Ping externe optionnel : un scheduler (UptimeRobot, cron, etc.) peut appeler périodiquement `/api/health` pour garder le service actif.

### Script manuel de wake-up

Script : `backend/scripts/warmup_ping.py`

Exécution manuelle (one-shot, compatible cron) :

```bash
BACKEND_URL=https://xxx.onrender.com python backend/scripts/warmup_ping.py
```

Variables d'environnement :

- `BACKEND_URL` (ex: `https://xxx.onrender.com`)
- `WARMUP_HEALTH_PATH` (défaut: `/api/health`)
- `WARMUP_TIMEOUT_SECONDS` (défaut: `3`)

Logs du script :
- `Warmup ping success` (avec statut HTTP et latence)
- `Warmup ping failed` (avec latence et erreur)

### Configuration recommandée UptimeRobot (optionnel)

UptimeRobot est utile si l’hébergeur met le service en veille.

- Type de monitor : `HTTP(s)`
- URL : `https://xxx.onrender.com/api/health`
- Intervalle : `5 minutes` (plan gratuit)
