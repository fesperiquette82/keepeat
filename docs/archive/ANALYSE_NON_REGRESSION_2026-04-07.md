# Analyse des erreurs et des tests de non-régression manquants (2026-04-07)

## Périmètre analysé
- Exécution de la suite Python (`pytest -q`) à la racine du repo.
- Lecture ciblée des fichiers backend et tests impactés :
  - `backend/server.py`
  - `tests/test_premium_guards_v1.py`
  - `tests/test_recipes_suggestions_api.py`

## Erreurs constatées

### 1) Test en échec : quota IA (comportement attendu ≠ implémentation actuelle)
- Test en échec : `PremiumGuardsV1Tests.test_ai_quota_exceeded_returns_standard_error`.
- Le test attend un `HTTPException(429)` après 6 appels.
- Dans l’implémentation actuelle de `get_ai_recipes`, le quota n’est consommé **qu’après** un appel OpenAI réussi, et la route retourne immédiatement `[]` si le stock est vide (donc sans consommation). Cela rend le scénario de test invalide lorsque le stock mocké est vide.
- Point de code :
  - garde d’accès sans consommation en entrée,
  - retour anticipé sur stock vide,
  - consommation après appel externe réussi.

### 2) Erreur de test : `NameError` dans `test_recipes_suggestions_api.py`
- Deux tests échouent avant assertion métier :
  - `test_non_premium_keeps_existing_flow_without_gpt_call`
  - `test_premium_enriches_suggestions_with_gpt_recipes`
- Cause : références non définies (`_FakeStockCol`, `score_recipe_against_stock`, `server`, `self._recipe`).
- C’est une erreur de construction du test (setup incomplet), pas un échec fonctionnel du runtime backend.

### 3) Incohérence de contrat test/config OpenAI
- Certains tests patchent des variables/flux historiques orientés GPT sur les suggestions (`OPENAI_API_KEY`, enrichissement premium dans `get_recipe_suggestions`) alors que la logique active est concentrée sur `get_ai_recipes` et utilise `KEEPEAT_OPENAI_TOKEN`.
- Résultat : les tests semblent écrits pour un contrat antérieur et ne reflètent plus le comportement actuel.

## Tests unitaires de non-régression manquants (prioritaires)

### A. Non-régression quota IA
1. **Stock vide ne consomme pas de quota IA**
   - Vérifier que `get_ai_recipes` retourne `[]` sans incrément quota quand aucun item actif.
2. **Erreur OpenAI (HTTP != 200) ne consomme pas de quota IA**
   - Vérifier qu’un échec fournisseur ne débite pas l’utilisateur.
3. **Réponse OpenAI valide consomme exactement 1 quota**
   - Vérifier l’incrément unique, y compris avec plusieurs recettes retournées.
4. **Cache IA 1h : pas de double consommation**
   - Vérifier qu’un second appel servi par cache ne recrédite pas/décrémente pas à nouveau.

### B. Non-régression suggestions recettes (`/recipes/suggestions`)
1. **Contrat actuel sans enrichissement GPT implicite**
   - Vérifier que la route reste déterministe sur `recipes_col` + matching local.
2. **Meta cohérente avec `include_meta=true`**
   - Vérifier `returned`, `total_candidates`, `gap_logged`, et headers debug.
3. **Mapping de filtre legacy**
   - Déjà partiellement couvert (`stock -> all`) ; compléter avec cas inconnus/filtres non supportés.

### C. Robustesse des tests eux-mêmes
1. Ajouter une couche de fixtures/fakes partagées pour éviter les `NameError`.
2. Ajouter un test de “sanity import” des helpers utilisés par les suites critiques.

## Recommandations de correction
1. Corriger d’abord `tests/test_recipes_suggestions_api.py` (références non définies).
2. Réécrire `test_ai_quota_exceeded_returns_standard_error` pour un scénario réaliste (stock non vide + mock OpenAI réussi).
3. Aligner les tests sur la variable de config réellement utilisée (`KEEPEAT_OPENAI_TOKEN`).
4. Ajouter les tests manquants de section A pour verrouiller la règle “quota uniquement après succès réel”.

## Résultat brut observé
- `pytest -q` : **3 échecs, 73 succès**.
- Échecs localisés dans les deux fichiers mentionnés ci-dessus.
