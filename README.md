# KeepEat

Application mobile anti-gaspillage alimentaire composée d'un backend FastAPI/MongoDB et d'un frontend Expo/React Native.

## Structure

- `backend/` : API FastAPI, logique métier, accès MongoDB, notifications et intégrations externes.
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
```

### Smoke tests backend

Le script suivant cible `http://localhost:8000` par défaut ; vous pouvez surcharger l'URL avec `KEEPEAT_BASE_URL`.

```bash
python backend_test.py
```
