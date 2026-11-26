# Auto-merge policy (PRs to `main`)

## Merge manuel vs auto-merge scripté
- **Merge manuel GitHub** : reste possible selon les règles natives GitHub / branch protection.
- **Auto-merge scripté (`Enable auto-merge on PRs to main`)** : plus strict. Il ne fusionne (squash, directement, sans `--auto` depuis BUG-104) que si tous les checks critiques sont **présents** et en **`completed + success`**, puis lance les workflows post-fusion (voir « Après la fusion »).

`Ready to merge` affiché par GitHub n'est **pas** un critère suffisant pour le workflow scripté.

## Checks critiques obligatoires
Le workflow vérifie explicitement, sur le **head SHA** de la PR :
1. `Frontend regression tests`
2. `Backend regression tests`
3. `Non-regression policy checks`
4. `Backend admin dashboard tests`
5. `Mobile E2E / Changes detection gate`

Ensuite, pour la partie Mobile E2E :
- soit `Mobile E2E / Not required (changes filter)` est en `completed + success` (skip explicitement justifié) ;
- soit `Mobile E2E / Build Android debug APK` **et** `Mobile E2E / Maestro E2E suite` sont tous les deux en `completed + success`.

## Règle de décision
Pour chaque check attendu :
- si le check est absent => **BLOCK**
- si `status != completed` => **BLOCK**
- si `conclusion != success` => **BLOCK**

Donc les états `pending`, `queued`, `in_progress`, `skipped`, `cancelled`, `timed_out`, `action_required`, `neutral`, `failure` bloquent l'activation auto-merge.

## Après la fusion (BUG-104)
Une fusion faite avec le jeton du workflow (`GITHUB_TOKEN`) ne déclenche **aucun** workflow `push` sur `main` (règle GitHub contre les boucles ; seuls `workflow_dispatch` et `repository_dispatch` y échappent). Après la fusion automatique de la PR #173, ni le déploiement du back-end, ni les contrôles post-fusion, ni l'APK n'ont tourné : la production est restée sur l'ancienne version.

Le workflow fusionne donc lui-même, directement (une fusion « armée » avec `--auto` serait faite plus tard par GitHub, sans étape pour la suite), puis `scripts/ci/post_merge_dispatch.py` lance sur `main` ce qu'une fusion à la main aurait déclenché, avec le filtre de chemins de chaque déclencheur `push` :

| Workflow | Lancé quand |
|---|---|
| `main-release-post-merge.yml` (contrôles post-fusion) | toujours |
| `deploy-render-backend.yml` (déploiement Render) | la PR touche `backend/**` ou ce workflow |
| `build-android-apk.yml` (APK de release) | toujours |

Jamais relancés : `ci.yml` et `admin-dashboard-monitoring.yml` (pas de lancement manuel ; les contrôles post-fusion rejouent les suites complètes), `mobile-e2e.yml` (exigé sur la PR par le verrou, rejoué chaque nuit par `mobile-e2e-nightly.yml`).

- Liste des fichiers de la PR illisible ou tronquée (l'API n'en rend que 3 000) : tout est lancé.
- Une panne passagère de l'API est réessayée ; un lancement impossible fait échouer l'étape, en rouge dans l'onglet Actions.
- Deux exécutions concurrentes : une seule fusionne et lance la suite ; l'autre l'annonce par un avertissement.
- Si l'étape a échoué, ou si l'avertissement « déjà fusionnée » apparaît sans qu'une autre exécution ait lancé la suite : lancer à la main, depuis l'onglet Actions, « Main/Release post-merge checks », « Deploy Render Backend » (si la PR touche le back-end) et « Build Android APKs ».
- Une fusion à la main (bouton GitHub) déclenche ces workflows normalement, comme avant.
- File de fusion (merge queue) : aucune n'est exigée sur `main` (ni protection de branche, ni ruleset ; le `merge_group:` de `ci.yml` n'est qu'un déclencheur inactif). Si une file est activée un jour, GitHub refusera la fusion directe : l'étape échouera en rouge et la PR restera ouverte, sans fusion non contrôlée. Il faudra alors faire passer la fusion par la file et lancer la suite une fois la fusion faite (remarque de Codex sur la PR #174).
- Le contrôle de production (`production-health-check.yml`, toutes les 15 minutes) signale un back-end en production plus ancien que le dernier commit back-end de `main`.

## Sécurité
- Le workflow ignore les PR `draft`.
- Le workflow ignore les PR vers une base différente de `main`.
- Le workflow ignore les forks non fiables (head repo différent du repo cible).
- Le workflow n'exécute aucun push direct sur `main` et n'altère pas la branch protection.
- Les scripts exécutés (verrou de relecture, lancement post-fusion) viennent de `main`, jamais de la branche de la PR.
- Une PR fermée ou déjà fusionnée est ignorée.
- Si une étape échoue, un auto-merge armé à la main est désarmé, même quand l'identification de la PR a échoué (numéro repris de l'événement, BUG-105).

## Cas Mobile E2E en cours / skip
- Si Mobile E2E est requis, et qu'un des checks build/maestro est encore en cours (`in_progress`/`queued`) ou non-success, l'auto-merge n'est pas activé.
- Si Mobile E2E est skip **sans** check explicite `Not required (changes filter)` en succès, l'auto-merge est bloqué.

## Diagnostic en cas de non activation auto-merge
Les logs affichent un tableau :
- check attendu ;
- status ;
- conclusion ;
- décision (`OK`/`BLOCK`).

Le message `Critical checks gate failed` indique qu'au moins un check attendu est absent ou pas en `completed + success`.
