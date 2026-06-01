# KeepEat — Règles Obligatoires pour Claude Code

**Version**: 1.0  
**Scope**: S'applique à TOUS les agents. Non-bloquant sauf si mentionné **🔴 BLOQUANT**.

---

## Règles Critiques (🔴 BLOQUANT)

### 1. Secrets & Environment
- ❌ **Jamais** hardcoder keys, tokens, URLs de DB en clair
- ✅ Utiliser env vars (`.env` local ou GitHub Secrets)
- ✅ Check: `grep -r "mongodb://\|api_key\|token" src/ | grep -v ".env"`

### 2. User Isolation (Backend)
- ✅ **Toujours** filtrer requêtes par `user_id` actuel (auth token → extract user_id)
- ✅ 401 (token expiré) ≠ 403 (permission denied)
- ❌ **Jamais** retourner données autre utilisateur silencieusement

### 3. OCR Atomicité
- ✅ Tout appel OCR = succeed OU fail (jamais partial write)
- ✅ DB transaction ou rollback complet sur erreur
- ✅ Logger événement (`ocr_processed` ou `ocr_failed`) si monitoring existe

### 4. Tests Avant Merge
- ✅ Bug fix → min 1 test unit (prouver bug + fix)
- ✅ Feature = 3-level: unit + integration + E2E si user-visible
- ✅ Run: `npm run test:ci` → tous tests passent

### 5. API Changes Validées
- ✅ Nouveau field API → vérifier frontend peut l'ignorer (optional)
- ✅ Field supprimé → vérifier frontend ne dépend pas
- ✅ Type change → frontend/backend alignés (test contrat si existe)

---

## Règles Pragmatiques (⚠️ CONSEILLÉ)

### 6. Pas Gros Refactor Auto
- ✅ Petit refactor 1 fichier : Explore + Edit OK
- ⚠️ Multi-fichier : Plan d'abord + approuv manuelle

### 7. Frontend Env Vars (Expo)
- ✅ Préfixer par `EXPO_PUBLIC_*` (ex: `EXPO_PUBLIC_API_URL`)
- ✅ Respecter conventions existantes du repo (ne pas inventer)

### 8. Auth 401 Handler
- ✅ 401 Unauthorized = afficher dialog erreur (pas logout silencieux)
- ✅ Laisser utilisateur retry/login à nouveau

---

## Pre-Commit Minimal

```
✅ Tests passent (npm run test:ci)
✅ Pas de secrets visibles
✅ User isolation vérifiée (si backend)
✅ API changes alignées frontend/backend
✅ Commit format: fix(x), feat(x), refactor(x)
```

Run: `npm run validate` avant push.

---

**Bloquant = No merge if violated. Pragmatique = best practice, humain tranche sur ambiguïté.  
Escalade**: Si règle incertaine, check CLAUDE.md ou demander pair review.
