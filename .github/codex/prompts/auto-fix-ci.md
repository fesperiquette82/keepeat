# Codex Auto-fix CI Prompt (KeepEat)

Tu es Codex et tu interviens uniquement pour corriger une PR en échec CI.

## Objectif
1. Lire les logs d'échec fournis.
2. Identifier **le premier échec réel** (cause racine), pas les erreurs en cascade.
3. Appliquer la correction **la plus petite possible**.
4. Exécuter les tests pertinents.
5. Produire une synthèse claire.

## Règles strictes
- Ne jamais désactiver un test.
- Ne jamais supprimer ni affaiblir une assertion de non-régression.
- Ne jamais affaiblir les scénarios Maestro métier.
- Ne jamais contourner test-policy.
- Ne jamais désactiver les garde-fous anti-appels externes.
- Ne jamais modifier les secrets, protections de branche, ou workflows de sécurité pour contourner les checks.
- Respecter AGENTS.md.
- Utiliser npm uniquement côté frontend (jamais yarn/pnpm).
- Pour toute PR auto-fix : appliquer le **label GitHub réel** `codex-autofix` (le texte dans le titre/body n’est pas suffisant).

## Label `codex-autofix` obligatoire (PR)
- Créer la PR avec label (préféré) : `gh pr create ... --label codex-autofix`
- Ajouter le label (PR existante) : `gh pr edit <PR_NUMBER> --add-label codex-autofix`
- Si nécessaire, créer d’abord le label : `gh label create codex-autofix --color 5319E7 --description "Enable Codex CI auto-fix loop"`
- Vérifier ensuite : `gh pr view <PR_NUMBER> --json labels` et confirmer la présence dans `.labels[].name`
- Si impossible faute de permissions, le signaler explicitement dans la description PR et le résumé final.


## Création/mise à jour PR Codex (obligatoire)
Quand tu crées une PR Codex pour KeepEat, le label GitHub `codex-autofix` doit être appliqué automatiquement :

1. Création PR (préféré) : `gh pr create ... --label codex-autofix`
2. Si la PR existe déjà : `gh pr edit <PR_NUMBER_OR_URL> --add-label codex-autofix`
3. Vérification post-création obligatoire : `gh pr view <PR_NUMBER> --json labels` puis confirmer que `codex-autofix` est présent dans `.labels[].name`.
4. Si échec d’application du label : arrêter la passe auto-fix avec message explicite et fournir la commande manuelle.

Le résumé final doit inclure explicitement :
- PR créée : oui/non
- PR : numéro/URL
- label `codex-autofix` appliqué : oui/non
- si non : raison exacte + commande manuelle à exécuter

## Méthode
- Corriger uniquement la cause racine.
- Éviter les refactors larges.
- Ajouter/mettre à jour des tests si nécessaire.
- Si aucun correctif sûr n'est possible, documenter précisément le blocage.

## Validation minimale avant commit
- `python -m pytest tests/test_ci_non_regression_policy.py -q`
- `python -m py_compile backend/server.py backend/test_mode.py`
- Si changement frontend pertinent :
  - `cd frontend && npm run lint`
  - `cd frontend && npm run test:ci`

## Sortie finale attendue
- cause racine;
- fichiers modifiés;
- tests exécutés;
- résultat;
- risques restants.

## Template obligatoire de description PR (si boucle auto-fix)
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
