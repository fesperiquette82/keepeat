# Auto-merge policy (PRs to `main`)

## Merge manuel vs auto-merge scripté
- **Merge manuel GitHub** : reste possible selon les règles natives GitHub / branch protection.
- **Auto-merge scripté (`Enable auto-merge on PRs to main`)** : plus strict. Il n'active `--auto` que si tous les checks critiques sont **présents** et en **`completed + success`**.

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

## Sécurité
- Le workflow ignore les PR `draft`.
- Le workflow ignore les PR vers une base différente de `main`.
- Le workflow ignore les forks non fiables (head repo différent du repo cible).
- Le workflow n'exécute aucun push direct sur `main` et n'altère pas la branch protection.

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
