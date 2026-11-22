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
- label GitHub PR réel `codex-autofix` (vérifié via l’API des labels de la PR)
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
- skip si acteur bot (`codex`, `github-actions[bot]`)
- skip si commit déjà marqué autofix (`codex auto-fix` / `codex-autodebug`)
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
- n’altère pas les workflows `auto-merge`, `release` ou `mobile-e2e` (isolation dans `codex-auto-fix.yml`)

## Relecture avant fusion automatique (BUG-097)
L’auto-merge (`.github/workflows/auto-merge-pr.yml`) fusionne une PR verte vers `main`. Une PR touchée par Codex n’y a droit qu’après relecture de son **commit de tête exact**. Les autres PR ne sont pas concernées.

### PR concernées
Codex ouvre ses PR et signe ses commits sous le compte du propriétaire : son identité ne le distingue pas. Le verrou (`scripts/ci/codex_fix_review_gate.py`, toujours exécuté depuis `main`, jamais depuis la branche de la PR) se fonde sur des faits :
- étiquette `codex` (posée par l’intégration GitHub de Codex) ou `codex-autofix`, même retirée depuis ;
- branche `codex/…` ;
- demande adressée à Codex sur la PR (description, commentaire, revue de code) : c’est le cas dès que la boucle ci-dessus a publié son commentaire ;
- par précaution : PR ouverte par un autre compte que le propriétaire, ou commit d’un compte hors de la liste de confiance (propriétaire, `claude`, `web-flow`).

### Verdict de relecture
Un commentaire de PR, écrit sous le compte du propriétaire, contenant l’un des deux marqueurs :

```text
<!-- codex-fix-review: sha=<SHA complet du commit de tête> verdict=approved -->
<!-- codex-fix-review: sha=<SHA complet du commit de tête> verdict=changes-requested -->
```

- Le verdict est lié au SHA : tout nouveau commit l’invalide, la relecture est à refaire.
- Le dernier verdict posté pour ce SHA l’emporte (`changes-requested` retire une approbation).
- Un verdict écrit par un autre compte, ou par l’intégration GitHub de Codex, ne compte pas.
- Sans approbation : pas de fusion automatique, et un auto-merge déjà armé est désarmé.
- Erreur d’API, script introuvable, liste de commits tronquée : refus, visible en rouge dans le workflow.
- La fusion est demandée avec `--match-head-commit` : un commit poussé entre la relecture et la fusion fait échouer la commande.

### Qui relit
Une session Claude à qui le propriétaire a demandé de suivre la PR (procédure dans `CLAUDE.md`), ou le propriétaire lui-même. Sans session ouverte, la PR attend : poster le marqueur à la main, ou fusionner à la main.

### Ce que la relecture vérifie
Le diff complet du commit de tête contre `main`, pas le résumé de Codex :
- aucun test supprimé, sauté ou désactivé ; aucune assertion retirée ou affaiblie ;
- aucun scénario Maestro allégé, aucun `optional: true` ajouté pour masquer un échec ;
- aucun workflow, garde-fou, seuil ou script de validation modifié pour faire passer un check ;
- un changement limité à la cause de l’échec corrigé, avec son test de non-régression ;
- aucun secret, jeton ou donnée personnelle dans le code ou les journaux.

### Limites
- C’est un garde-fou de processus : une IA en relit une autre, et un outil qui détient le jeton du propriétaire peut techniquement écrire le marqueur. Codex a pour consigne de ne jamais le faire.
- Un travail de Codex qui ne laisse aucun des signaux ci-dessus (branche renommée, pas d’étiquette, pas de demande sur la PR) n’est pas reconnu.
- Le workflow et le script s’exécutent depuis `main` : une modification du verrou ne prend effet qu’une fois fusionnée.

## Permissions GitHub minimales
- `actions: read`
- `checks: read`
- `contents: read`
- `pull-requests: write`

## Gestion du label `codex-autofix`
- Pour toute PR Codex, créer la PR avec le label : `gh pr create ... --label codex-autofix`
- Si la PR existe déjà, ajouter le label : `gh pr edit <PR_NUMBER> --add-label codex-autofix`
- Vérifier le label : `gh pr view <PR_NUMBER> --json labels` puis confirmer `codex-autofix` dans `.labels[].name`
- Si le label n’existe pas : `gh label create codex-autofix --color 5319E7 --description "Enable Codex CI auto-fix loop"`
- Si permissions insuffisantes : documenter explicitement l’échec dans la description PR et le résumé final avec PR créée (oui/non), PR (numéro/URL), label appliqué (oui/non), raison exacte et commande manuelle.

## Désactiver l’auto-debug sur une PR
- retirer le label `codex-autofix`
- ou utiliser une branche cible non autorisée

## Lire les sorties
- commentaire `@codex` sur la PR
- artifact du workflow `codex-auto-debug-<run_id>` contenant :
  - `diagnostic.md`
  - logs sanitizés
  - artifacts téléchargés (si disponibles)
