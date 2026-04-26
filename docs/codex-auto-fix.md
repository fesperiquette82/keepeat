# Boucle CI auto-debug Codex

## Objectif
Quand un check CI critique échoue sur une PR, publier automatiquement un commentaire `@codex` avec diagnostic (logs + artifacts), sans copier/coller manuel côté développeur.

## Déclenchement
Workflow : `.github/workflows/codex-auto-fix.yml`.

Il se déclenche sur `workflow_run: completed` pour :
- `CI`
- `Mobile E2E (Maestro)`
- `Admin dashboard monitoring tests`

Conditions strictes :
- conclusion `failure`
- run lié à une PR
- label PR `codex` ou `auto-fix`
- branche cible autorisée (`main` / `release/*`)
- PR non-fork non fiable
- check échoué dans la liste surveillée

## Checks surveillés
Liste centralisée dans `WATCHED_CHECKS_JSON` :
- `Non-regression policy checks`
- `Mobile E2E / PR smoke Maestro suite`
- `Mobile E2E / Build Android debug APK`
- `Backend admin dashboard tests`
- `Vercel` (si présent via check-runs)

## Anti-boucle
- marqueur unique : `<!-- codex-autodebug: sha=... workflow=... job=... -->`
- un seul commentaire auto-debug par combinaison PR + workflow + job + SHA
- max `2` tentatives par SHA (`MAX_ATTEMPTS_PER_SHA`)
- skip explicite dans les logs :
  - `auto-fix skipped: no PR`
  - `auto-fix skipped: missing label`
  - `auto-fix skipped: fork PR`
  - `auto-fix skipped: already attempted for this SHA`

## Données collectées
- logs du job échoué (`gh run view --job ... --log`)
- artifacts du run en échec (`gh run download ...`, best effort)
- diagnostic markdown synthétique + extraits tronqués
- classification heuristique (Maestro driver/emulator vs assertion métier, reset/seed, etc.)

## Ce que la boucle ne fait pas
- ne build pas l’APK
- ne lance pas Gradle / Expo prebuild
- ne lance pas Maestro
- ne démarre pas d’émulateur
- ne pousse pas de code
- ne fait jamais d’auto-merge

## Permissions GitHub minimales
- `actions: read`
- `checks: read`
- `contents: read`
- `pull-requests: write`

## Désactiver l’auto-debug sur une PR
- retirer les labels `codex` / `auto-fix`
- ou utiliser une branche cible non autorisée

## Lire les sorties
- commentaire `@codex` sur la PR
- artifact du workflow `codex-auto-debug-<run_id>` contenant :
  - `diagnostic.md`
  - logs sanitizés
  - artifacts téléchargés (si disponibles)
