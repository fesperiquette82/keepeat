# KeepEat — Agent Router par Type de Tâche

Quel agent utiliser? Consulte ce tableau. Applicable sauf cas spécial.

---

| Tâche | Quand | Agent | Limite |
|-------|-------|--------|---------|
| **Bug UI/crash** | Utilisateur rapporte crash, layout cassé | Explore → Edit | 1 file, test unit |
| **Bug API** | Erreur backend 401/500 | Explore → Edit | Handler seul, pas refactor |
| **Bug OCR** | OCR partiellement écrit DB | General-Purpose | Verify atomicity + test |
| **Hotfix urgent** | Déploiement production broken | Edit direct | Min testing, doc PR |
| **Feature mobile** | Nouvel écran/bouton | Plan → Dev-task | 3-level tests requis |
| **Feature API** | Nouvel endpoint | Plan → Dev-task | Contract test si nouveau |
| **Feature multi-layer** | Mobile + API + admin | Plan → Dev-task | 3-level + observable signal |
| **Feature OCR** | Amélioration OCR logic | Plan → General-Purpose | Mock external API |
| **Refactor 1 file** | Cleanup code petit | Explore → Edit | 0 behavior change |
| **Refactor multi-file** | Réorganisation structure | Plan + manual review | Risk élevé → humain approuve |
| **Audit sécurité** | Check isolation, auth | Plan → Explore | Read-only report |
| **Audit test** | Couverture tests | Explore | Report, pas modification |
| **Debug CI** | GitHub Actions failed | Explore → Edit | Fix YAML/config seulement |
| **Fix build** | APK/iOS build error | General-Purpose | Platform-specific |

---

## 🎯 Simple Decision

```
Bug?          → Explore + Edit (SKIP dev-task, 1 file max)
Feature?      → Plan (approval) → Dev-task auto (tests included)
Refactor?     → 1 file = Explore + Edit OK
              → Multi = Plan + humain review
Audit?        → Read-only : Plan + Explore (no skills)
CI/CD?        → Edit YAML only (no local execution)
```

---

## ⚡ Important

- **SKIP dev-task** sur bug/hotfix (pas de tests stricts)
- **Always Plan** avant feature ou gros refactor
- **Contract test** = nouveau endpoint API
- **3-level tests** = feature visible utilisateur (unit + integration + E2E)
- **No local CI run** (tester sur branch uniquement)

---

Pin to IDE. Updated as needed.
