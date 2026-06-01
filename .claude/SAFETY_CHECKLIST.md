# KeepEat — Pre-Commit Safety Checklist

**Avant `git commit` ou `git push`. Items N/A = non applicable à cette tâche (cocher et skiper).**

---

## 🔴 BLOQUANT (Must-Pass)

### Secrets
- [ ] ❌ Pas de `API_KEY`, `TOKEN`, `MONGO_URL` en dur dans code
- [ ] ✅ Secrets en `.env` (local) ou GitHub Secrets

### User Isolation (Backend seulement)
- [ ] ✅ Backend requête filtrée par `user_id` actuel
- [ ] ❌ Jamais retourner données autre utilisateur
- [N/A] Si no backend change → cocher N/A

### OCR Atomicité (OCR changes seulement)
- [ ] ✅ Tout OCR = succeed OU fail (jamais partial)
- [ ] ✅ DB transaction ou rollback complet
- [N/A] Si no OCR change → cocher N/A

### Tests Exécutés
- [ ] ✅ `npm run test:ci` = tous tests PASS
- [ ] ✅ Bug fix = min 1 test unit added
- [ ] ✅ Feature visible = 3-level tests (unit + intégration + E2E si user-facing)

### API Changes Validées (si endpoint modifié)
- [ ] ✅ Frontend peut ignorer new fields (optional)
- [ ] ✅ Removed fields = frontend not dependent
- [ ] ✅ Type changes = frontend/backend alignés
- [N/A] Si no API change → cocher N/A

---

## ⚠️ CONSEILLÉ (Best Practice)

### Auth 401 Handler (auth changes seulement)
- [N/A] Pas de changement auth → skip
- [ ] ✅ 401 = error dialog (pas logout silencieux)

### Env Vars (Frontend)
- [N/A] Pas de env var change → skip
- [ ] ✅ Frontend vars use `EXPO_PUBLIC_*` prefix

### Commit Message
- [ ] ✅ Format: `fix(scope)`, `feat(scope)`, `refactor(scope)`
- [ ] ✅ Décrit QUOI (pas juste "fix bug")
- [ ] ✅ Lie issue: `Fixes #BUG-X` ou `Feature #Y`

---

## 🎯 Final

- [ ] ✅ Run: `npm run validate` (pré-commit)
- [ ] ✅ Tests pass: `npm run test:ci`
- [ ] ✅ Diff OK: `git diff --staged` (visuel)
- [ ] ✅ Push feature branch first (pas main direct)

---

**BLOQUANT échoué = DO NOT commit.**  
**CONSEILLÉ = best practice ; ambiguïté = pair review ou ask.**

