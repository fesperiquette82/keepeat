# Codex Auto-fix (diagnostic loop only)

## Objectif
Créer une boucle **CI échoue → collecte diagnostic → commentaire PR @codex** sans push automatique de code.

## Déclencheurs
Workflow : `.github/workflows/codex-auto-fix.yml`.

- `workflow_run` sur:
  - `CI`
  - `Mobile E2E (Maestro)`
  - `Admin dashboard monitoring tests`
- `workflow_dispatch` avec `run_id` (rejeu manuel sur un run échoué)

## Garde-fous
Le workflow s’arrête si :
- le run n’est pas `failure`;
- le run n’est pas lié à une PR;
- la PR vient d’un fork non fiable (`head.repo.full_name != repo`);
- la branche `master-production` est impliquée;
- le label PR `codex-autofix` est absent;
- la tentative dépasse `MAX_ATTEMPTS_PER_SHA=2`;
- un commentaire avec le même marker HTML existe déjà.

## Label GitHub obligatoire (`codex-autofix`)
Pour être éligible à la boucle auto-fix, la PR doit porter le **vrai label GitHub PR** `codex-autofix`.

- Le titre ou le body de PR ne suffisent pas.
- Le workflow vérifie les labels GitHub via l’API PR (`.labels[].name`) et n’accepte pas un simple texte.
- En cas d’absence du label, la boucle est stoppée (`auto-fix skipped: missing label`).

Commande recommandée :
`gh pr edit <PR_NUMBER> --add-label codex-autofix`

Si le label n’existe pas encore :
- tenter de le créer (`gh label create codex-autofix --color 5319E7 --description "Enable Codex CI auto-fix loop"`),
- puis l’appliquer,
- puis vérifier sa présence (`gh pr view <PR_NUMBER> --json labels`).

Si l’application du label échoue faute de permission, l’indiquer explicitement dans le résumé final et dans la description de PR.

## Marker anti-boucle
Chaque commentaire inclut :

`<!-- codex-autodebug: sha=<sha> workflow=<workflow> job=<job> -->`

et un compteur de tentative.

## Collecte de diagnostic
Le workflow collecte en best effort :
- log job échoué (`gh run view ... --log`);
- artifacts du run (`gh run download ...`);
- résumé markdown avec:
  - workflow échoué,
  - run URL,
  - job/check échoué,
  - step échoué (si détecté),
  - extrait d’erreurs,
  - liste des fichiers artifacts trouvés.

## Commentaire PR
Le workflow poste un commentaire avec `@codex` contenant :
- marker anti-boucle HTML;
- contexte run/check;
- règles anti-régression;
- prompt d’action clair;
- diagnostic collecté.

## Template obligatoire de description PR (auto-fix)
Toute PR visant l’activation de la boucle `codex-autofix` doit inclure ce template minimum :

```md
## Objectif
Décrire le problème corrigé ou la boucle CI ciblée.

## Changements
Lister les fichiers modifiés et le rôle de chaque changement.

## Label auto-fix
- codex-autofix requis : oui
- label GitHub appliqué : oui/non
- raison : autoriser la boucle CI à commenter @codex uniquement sur cette PR

## Garde-fous
- pas de push direct sur master/master-production ;
- pas d’auto-merge ;
- pas de retry infini ;
- pas d’affaiblissement des assertions finales ;
- pas de masquage d’échec Maestro ;
- pas de rebuild APK implicite si un APK compatible peut être réutilisé.

## Validation
Lister les commandes exécutées et résultats.

## Limites restantes
Indiquer ce qui doit encore être confirmé par GitHub Actions réel.
```

## Important
- Le workflow **ne push jamais de code**.
- Le workflow **n’active jamais d’auto-merge**.


## Création de PR Codex : label auto appliqué
Pour toute PR créée par Codex pour KeepEat, appliquer le label réel dès la création :

- recommandé : `gh pr create ... --label codex-autofix`
- sinon juste après : `gh pr edit <PR_NUMBER_OR_URL> --add-label codex-autofix`

Vérification post-création obligatoire :
- `gh pr view <PR_NUMBER> --json labels`
- confirmer `codex-autofix` dans `.labels[].name` (pas de détection texte titre/body).

Si le label n’existe pas :
- `gh label create codex-autofix --color 5319E7 --description "Enable Codex CI auto-fix loop"`

Si permissions insuffisantes :
- ne pas échouer silencieusement ;
- indiquer dans la description PR et le résumé final : PR créée (oui/non), numéro/URL, label appliqué (oui/non), raison exacte et commande manuelle à exécuter.
