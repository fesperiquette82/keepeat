# Corrections — Audit des fragilités système (KeepEat)

> Date de l'audit : 2026-06-28
> Périmètre : backend FastAPI/MongoDB + frontend Expo/React Native.
> Méthode : analyse multi-agents (backend monolithe, services externes, state/sync frontend, sécurité transverse), avec vérification manuelle des findings les plus impactants.
> Statut global : **aucun fichier modifié** — ce document liste les correctifs à appliquer.

Légende statut : `OUVERT` | `EN COURS` | `CORRIGÉ`
Findings vérifiés manuellement marqués ✓.

---

## 🔴 CRITIQUE

### C1. Secrets de production live en clair dans `backend/.env` ✓ — `OUVERT`
- **Fichiers** : `backend/.env` (existe sur disque, ~1068 octets ; non versionné car couvert par `.gitignore:6-7`).
- **Risque** : contient `MONGO_URL` (identifiants Atlas live) et `JWT_SECRET_KEY` de prod. Quiconque obtient ce fichier peut se connecter directement à Mongo (toutes les données de tous les utilisateurs) et **forger n'importe quel JWT valide** (`auth_utils.py:60`), y compris un token admin → accès complet `/api/admin/*` + dump Mongo.
- **Fix** : roter immédiatement le mot de passe Atlas **et** le `JWT_SECRET_KEY` ; purger le `.env` de toute copie hors coffre ; ne distribuer que `.env.example`.

### C2. Premium « fail-open » : abonnement accordé sans paiement réel — `OUVERT`
- **Fichiers** : `backend/server.py:1703-1718` (verify), `:1614-1618` (RTDN `_handle_subscription_active`), `:1584-1589` (`_verify_google_play_subscription` retourne `None`), webhook RTDN `:1763-1818`.
- **Risque** : si `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` est absent **ou** si l'appel Google échoue/timeout, le code accorde 30 jours de premium sans valider le `purchase_token` (seul filtre : `startswith("demo_")`). En prod, une panne réseau Google = premium gratuit pour tout appelant authentifié. Le webhook RTDN est de plus non authentifié si `GOOGLE_RTDN_TOKEN` n'est pas défini.
- **Fix** : distinguer « non configuré (dev) » de « échec de vérification (prod) » via une variable d'env ; en production, refuser (`402/503`) au lieu d'octroyer (**fail-closed**). Rendre `GOOGLE_RTDN_TOKEN` obligatoire.

### C3. Plafond de coûts OCR/IA inefficace (TOCTOU + consume-after) — `CORRIGÉ` (2026-06-28)
- **Fichiers** : `backend/server.py:3262-3334` (OCR), `:4022-4182` (IA), `backend/entitlements.py:115-136`.
- **Risque** : le check d'accès initial est fait `consume_quota=False` **sans lire le compteur**, puis l'appel Gemini (payant) est exécuté, puis seulement le compteur est incrémenté. N requêtes concurrentes passent toutes le check avant tout `$inc` → dépassement du quota mensuel et **appels Gemini facturés au-delà de la limite**. Un user free déjà à 10/10 peut déclencher un 11e appel payant ; le 429 ne tombe qu'après.
- **Correctif appliqué** : pattern *réserver-puis-rembourser*. Le quota est désormais **réservé atomiquement AVANT l'appel externe** (`consume_quota=True` déplacé en amont dans les endpoints OCR et IA) ; la requête au-delà de la limite est rejetée en 429 sans appeler Gemini. Ajout de `entitlements.refund_quota` (`$inc:-1` atomique, plancher à 0) et du helper `server._refund_feature_quota`, appelés sur tous les chemins d'échec de l'appel externe (préserve « pas de quota drainé sur échec »). Cache-hit / stock vide IA ne consomment toujours pas (réservation placée juste avant l'appel réseau).
- **Tests** : `backend/tests/test_quota_cost_ceiling.py` (6 tests : remboursement + plancher, réservation→429, over-limit bloque AVANT l'appel, remboursement net nul sur échec, consommation unique sur succès). Suite backend complète : **234 passed**.

### C4. Perte silencieuse des mutations offline au redémarrage ✓ — `CORRIGÉ` (2026-06-28)
- **Fichiers** : `frontend/store/stockStore.ts:205-207` (`if (online && wasOffline)`), `:214-259` (`flushPendingMutations`), `frontend/utils/useNetworkSync.ts:12-26`.
- **Risque** : `flushPendingMutations()` ne se déclenche **que** sur transition offline→online. Au démarrage, `isOnline` vaut déjà `true` → `wasOffline=false` → aucun flush. Scénario : l'utilisateur ajoute/consomme hors-ligne, ferme l'app, la rouvre avec réseau → les `pendingMutations` (persistés) restent en attente indéfiniment tant que le réseau ne retombe pas puis remonte. **Opérations offline jamais envoyées au serveur.**
- **Correctif appliqué** : nouvelle décision pure `frontend/utils/onlineSyncDecision.ts` (`resolveOnlineSyncAction`) — on flushe dès qu'on est **en ligne avec des mutations en attente**, y compris au démarrage (sans transition) ; le `fetch` de rafraîchissement reste réservé à une vraie transition sans mutation (évite le spam). `setOnline` branché dessus. Ajout d'un `onRehydrateStorage` au `persist` du store pour couvrir le cas où l'hydratation AsyncStorage se termine **après** le `NetInfo.fetch()` initial. `flushPendingMutations` reste protégé par `isSyncing` (double-appel sans effet).
- **Tests** : `frontend/utils/onlineSyncDecision.test.ts` (5 cas, dont le scénario exact de perte de données). Frontend : unit **222 passed**, integration **6 passed**, smoke **2 passed**, typecheck OK.

---

## 🟠 ÉLEVÉ

### E1. Login plante en 500 (KeyError) pour comptes au schéma divergent ✓ — `CORRIGÉ` (2026-06-29)
- **Fichiers** : `backend/server.py:1345` (`doc["hashed_password"]`, accès direct), seed de test `:1026/1031` (écrit `password_hash`) vs register/login/reset (`hashed_password`), `:4617` (admin reset).
- **Risque** : tout compte seedé (clé `password_hash`) fait planter le login en **500 (KeyError)** au lieu de 401 ; les fixtures E2E ne reflètent pas le schéma réel produit → divergence silencieuse.
- **Correctif appliqué** : login et admin-reset utilisent `doc.get("hashed_password") or _DUMMY_HASH` (un document sans la clé → 401, jamais 500) ; `test_seed_data` écrit désormais `hashed_password`.
- **Tests** : `test_high_severity_audit.py::TestLoginHashedPasswordMissing` (401 ≠ 500) + assertion seed ; `test_test_mode_guards.py` aligné sur `hashed_password`.

### E2. Clé API Gemini en query-string → fuite dans les logs — `CORRIGÉ` (2026-06-29)
- **Fichiers** : `backend/ocr_service.py:427-430`, `backend/recipes_service.py:226`.
- **Risque** : `...:generateContent?key={gemini_key}` apparaît dans toute trace httpx/proxy/middleware loggant l'URL. Secret porteur de coûts exposé.
- **Correctif appliqué** : la clé n'est plus jamais dans l'URL. `_build_gemini_generate_content_url` ne prend plus `gemini_key` ; les 5 sites d'appel Gemini (ocr_service, recipes_service, et `_fetch_gpt_recipes`/`_ai_gap_fill`/`get_ai_recipes` dans server.py) passent la clé via le header `x-goog-api-key`.
- **Tests** : `test_high_severity_audit.py::TestGeminiKeyNotInUrl` (URL sans `key=`, header présent).

### E3. Résilience inégale des appels externes — `CORRIGÉ` (2026-06-29)
- **Fichiers** : `backend/recipes_service.py:223-242` (aucun retry, 429/SAFETY/réponse vide masqués en `None`), `backend/product_catalog.py:14-55` (cache « introuvable » **permanent** sur panne réseau transitoire → empoisonnement), `backend/alerts.py:54-89` (boucle `while True` sans plafond de pages), `:282-292` (appel themealdb dans la boucle par user, non gaté par test_mode).
- **Risque** : `ocr_service` est robuste (retry/backoff/parsing défensif) mais les autres modules partagent les mêmes modes de panne sans la même protection ; faux négatifs persistants, latence non bornée.
- **Correctif appliqué** : (1) `product_catalog` ne met en cache que les résultats **concluants** (réponse 200) — un échec réseau/non-200 ne crée plus de faux « introuvable » permanent ; (2) `fetch_recent_recalls` borne la pagination (`_MAX_PAGES=50`) avec log si plafond atteint ; (3) `_generate_ai_recipe` (helper, jusqu'ici non câblé) gagne retry+backoff sur 429/5xx et un extracteur défensif `_extract_gemini_recipe_text` (réponse vide / `blockReason` → `None`, plus de KeyError masqué).
- **Tests** : `test_high_severity_audit.py` (cache non empoisonné sur panne réseau, mise en cache d'un not-found concluant, extraction défensive).
- **Non traité (volontaire)** : l'appel themealdb dans la boucle par user (`alerts.py:282`) — optimisation de latence, pas un bug de correction ; à traiter séparément.

### E4. Mutations frontend non atomiques / rollback global ressuscitant des items — `CORRIGÉ` (2026-06-29)
- **Fichiers** : `frontend/store/stockStore.ts:214-259` (flush sur snapshot figé), `:499-504` et `:598-603` (rollback `markConsumed/markThrown` réécrit toute la liste avec snapshot périmé + `find(...)!` non-null forcé).
- **Risque** : mutations ajoutées pendant le flush écrasées ; rollback qui ré-affiche des items déjà supprimés par une opération concurrente (régression directe de la classe **BUG-034**, contournée par les `fetchStock` des écrans `recipes.tsx`/`stock.tsx` qui ne passent pas par la queue de swipe `stockSwipe.ts:44-57`).
- **Correctif appliqué** : nouveau helper pur `frontend/utils/stockRollback.ts` (`buildMarkActionRollback`) — le rollback réinsère **uniquement l'item concerné** dans l'état COURANT (via `buildRestoredItemsList`, sans doublon) et inverse précisément les deltas de stats, au lieu d'écraser la liste avec le snapshot. `markConsumed`/`markThrown` branchés dessus ; le `find(...)!` non-null est remplacé par un garde optionnel (`if (rolledBackItem)`).
- **Tests** : `frontend/utils/stockRollback.test.ts` (7 cas, dont « ne ressuscite pas un item retiré en parallèle » et deltas de stats consume/throw).
- **Note** : le flush sur snapshot figé (`flushPendingMutations`) reste à durcir — voir suivi (non bloquant ici, couvert par `isSyncing`).

### E5. Opérations multi-documents sans atomicité ni idempotence — `CORRIGÉ` (2026-06-29)
- **Fichiers** : `backend/server.py:3475-3506` (`process_receipt_ticket` : N `insert_one` en boucle puis update ticket `processed`).
- **Risque** : crash au milieu de la boucle → items partiellement insérés + ticket toujours `pending` → un retry admin **re-duplique** les produits. Aucune transaction Mongo, aucune idempotence.
- **Correctif appliqué** : (1) **revendication atomique** du ticket avant insertion (`find_one_and_update({status: {$ne: "processed"}})`) → un double-clic / appel concurrent renvoie **409** sans dupliquer ; (2) nettoyage des insertions partielles d'une tentative précédente via `delete_many({source_ticket_id})` (sûr grâce à la revendication) ; (3) `insert_many` en une seule opération ; les stock items portent `source_ticket_id` pour l'idempotence.
- **Tests** : `test_high_severity_audit.py::TestReceiptTicketIdempotency` (1er appel → `insert_many` une fois ; déjà traité → 409 sans insertion).

### E6. Réponses out-of-order : `fetchStock` concurrents écrasent un état plus récent — `CORRIGÉ` (2026-06-29)
- **Fichiers** : `frontend/store/stockStore.ts:261-307`, déclencheurs `app/(tabs)/index.tsx:23`, `stock.tsx:82`, `recipes.tsx:71-74` (`useFocusEffect`).
- **Risque** : pas de garde de séquence ni `AbortController` ; le `set({ items })` du GET le plus lent écrase celui du plus rapide ; pas d'annulation au unmount.
- **Correctif appliqué** : compteur de séquence monotone module-level `_stockFetchSeq` — chaque `fetchStock` capture son numéro avant le GET et, à la réception, ignore sa réponse si un fetch plus récent a démarré entre-temps (`fetchSeq !== _stockFetchSeq`). Plus de réponse périmée qui écrase un état à jour.
- **Note** : couvert par typecheck + suite frontend ; l'`AbortController` (annulation réseau au unmount) reste une amélioration optionnelle.

### E7. Rate limiting absent sur `verify-email` + basé IP seul — `CORRIGÉ partiellement` (2026-06-29)
- **Fichiers** : `backend/server.py:1367-1368` (pas de `@limiter.limit`, accorde directement un JWT de session `:1388`), `:898` (`Limiter(key_func=get_remote_address)`).
- **Risque** : brute-force du token d'activation (= prise de contrôle du compte) ; rate limit global contournable derrière proxy Render / `X-Forwarded-For` spoofé.
- **Correctif appliqué** : `verify_email` est désormais protégé par `@limiter.limit("5/minute")` (+ `request: Request` + `@_resolve_annotations`, pattern des autres routes auth). Le trou principal (brute-force du token) est fermé.
- **Différé (documenté)** : le *keying du login sur l'email* (anti brute-force distribué multi-IP) nécessite un suivi des échecs par compte (lockout) — feature à part entière, hors périmètre d'un fix ciblé ; à planifier. La config trusted-proxy Render relève de l'infra.

---

## 🟡 MOYEN

### M1. Incohérence d'état premium (MRR surévalué) — `OUVERT`
- **Fichiers** : `backend/entitlements.py:41-57` (`resolve_plan`) vs `backend/observability.py:163-173` (`resolve_plan_type_at_time`), `:230` (`build_monitoring_kpis`).
- **Risque** : `resolve_plan_type_at_time` ignore `subscription_expires_at` → un `is_premium=True` expiré compté comme premium dans les KPIs/MRR alors que les droits réels le considèrent free.
- **Fix** : une seule source de vérité pour résoudre le plan, partagée par entitlements et observability.

### M2. Mot de passe stocké en clair pour la biométrie — `OUVERT`
- **Fichiers** : `frontend/utils/biometricAuth.ts:8-10`, `frontend/store/authStore.ts:166-169`.
- **Risque** : `{email, password}` sérialisé en clair dans SecureStore. Une extraction du Keychain (appareil rooté, backup non chiffré) expose les identifiants permanents, pas juste une session.
- **Fix** : ne stocker qu'un token/refresh-token révocable côté serveur.

### M3. Écritures sur FS éphémère (Render) — `OUVERT`
- **Fichiers** : `backend/server.py:4972-4984` (`upload_debug_logs`, `models.py:314` `content` sans `max_length` → DoS disque), `:3842/4819/4902` (`append_recipe_to_catalog`, écriture JSON concurrente non atomique, lock thread non inter-process, `recipes_service.py:318-331`).
- **Risque** : données perdues au redeploy ; payload non borné ; corruption du catalogue JSON (write non atomique) ; divergence Mongo/JSON.
- **Fix** : borner `content` (`max_length`) ; stocker en Mongo/objet store ; écriture temp + `os.replace` ; idéalement Mongo comme source unique.

### M4. Requêtes Mongo non bornées — `OUVERT`
- **Fichiers** : `backend/server.py:4935` (`admin_dedup_recipes`, `to_list(length=None)` → toute la collection), `:2950` (scoring recettes O(recettes×stock) en RAM, `length=500`), `:2584/2548/1882/5013`.
- **Risque** : pression mémoire / latence croissante avec le volume.
- **Fix** : pagination réelle / agrégation côté Mongo ; remplacer `length=None` par une borne + boucle paginée.

### M5. Pas de versioning/migration du store persisté — `OUVERT`
- **Fichiers** : `frontend/store/stockStore.ts:782-792` (persist sans `version`/`migrate`), `frontend/store/appSettingsStore.ts:106-136`.
- **Risque** : mutations d'ancien schéma rejouées après mise à jour → POST malformés ou crash au flush.
- **Fix** : ajouter `version` + `migrate` ; valider/filtrer `pendingMutations` à l'hydratation.

### M6. Tâche de fond `alert_loop` fragile — `OUVERT`
- **Fichiers** : `backend/server.py:891-894` (cancel sans `await` avant `client.close()`), `backend/alerts.py:310-320` (un seul `except` global → perte de tous les checks du cycle sur une erreur).
- **Risque** : écritures Mongo coupées au shutdown ; une panne transitoire fait perdre les alertes J0/J2 du jour (fenêtre `hour < 12`).
- **Fix** : `cancel()` puis `await asyncio.gather(task, return_exceptions=True)` ; try/except par check individuel.

### M7. `str(exc)` exposé au client — `OUVERT`
- **Fichiers** : `backend/server.py:2147, 2417, 5000, 4879`.
- **Risque** : fuite de détails internes (chemins, erreurs Mongo) — surface de reconnaissance.
- **Fix** : message générique côté client, détail uniquement dans les logs.

### M8. Télémétrie bloquante / pouvant faire échouer l'endpoint — `OUVERT`
- **Fichiers** : `backend/server.py:1904, 1982, 1314` (`track_business_event` sans try/except), chemin OCR `:3254-3347` (4 écritures Mongo en série), `backend/observability.py:131-201`.
- **Risque** : si Mongo est lent/indispo, l'action métier déjà committée renvoie 500 ; latence OCR augmentée.
- **Fix** : best-effort (try/except + log) ; fire-and-forget (`asyncio.create_task`) pour les events non critiques.

### M9. Cache produit/barcode non purgé + faux négatifs — `OUVERT`
- **Fichiers** : `frontend/store/stockStore.ts:120, 629-638` (`_barcodeCache` jamais vidé, même au logout), `frontend/store/recipesStore.ts:71` (pas de reset au logout).
- **Risque** : croissance mémoire de session ; données d'un compte A visibles après login de B (peu sensible mais mauvais pattern).
- **Fix** : reset `_barcodeCache`, `recipesStore` et `stockStore` persisté dans `authStore.logout`.

---

## 🟢 FAIBLE / INFO

- **F1.** CORS `allow_origins=["*"]` par défaut (`server.py:1042-1058`) — `allow_credentials=False` limite l'impact ; restreindre via `CORS_ORIGINS` en prod.
- **F2.** Pages HTML admin servies sans auth (`server.py:5236, 5696, 6502`) — pas de secret embarqué, données via API protégée ; impact = reconnaissance de la structure admin.
- **F3.** Endpoints `/api/test/reset` et `/api/test/seed` présents en prod, gardés par `APP_ENV=test` (`server.py:1007-1039`, `test_mode.py:20`) — une mauvaise config d'env = destruction de données.
- **F4.** Codes HTTP incohérents pour ID invalides : `admin_resolve_recipe_gap:3200` fait `ObjectId(gap_id)` sans try/except → 500 au lieu de 400/404 ; body `Dict[str, Any]` non typé (`:3187`).
- **F5.** `seed_default_user` (`alerts.py:323-345`) crée un premium permanent via `SEED_EMAIL`/`SEED_PASSWORD` — gater strictement derrière `is_test_env()`.
- **F6.** `int(os.getenv(...))`/`float(...)` sans try/except (`admin_service_control.py:327-334`) → casse l'endpoint coûts si variable mal saisie.
- **F7.** Duplication de l'état `language` entre `appSettingsStore` et `languageStore` → risque de divergence UI.
- **F8.** Client Mongo global créé à l'import sans `serverSelectionTimeoutMS` ni fail-fast (`server.py:148-149`).
- **F9.** `subprocess` git au démarrage à l'import (`server.py:196-207`) — dépendance runtime fragile, `except Exception: pass`.

---

## Thèmes transversaux

1. **Plafond de coûts non garanti** (C3, E3) — risque financier #1 : Gemini OCR/recettes appelable au-delà du quota.
2. **Fail-open sur les chemins critiques** (C2 premium, E7 webhook RTDN) — la panne d'une dépendance ouvre des droits au lieu de les fermer.
3. **Résilience à deux vitesses** — seul OCR est durci ; les autres modules partagent les mêmes pannes sans protection.
4. **Atomicité absente** — côté Mongo (pas de transactions/idempotence) et côté store frontend (snapshots figés, rollbacks globaux).

## Points sains confirmés (ne pas régresser)

Isolation par `user_id` (pas d'IDOR sur le stock), bcrypt + politique de complexité, protection timing-attack au login (`_DUMMY_HASH`), tokens reset/verify imprévisibles avec expiration et `$unset` après usage, JWT en SecureStore (pas AsyncStorage), XSS échappé dans les pages redirect, compteur de quota atomique (`$inc`), autorisation admin ré-appliquée côté serveur (`_require_admin_user`).

---

## Ordre de traitement recommandé

1. **C1** (roter les secrets) — action immédiate, hors code.
2. **C2, C3** (fail-closed premium + plafond de coûts) — risque financier/sécurité.
3. **C4, E1** (perte de données offline + login 500) — bugs fonctionnels confirmés.
4. **E4, E6** (races frontend ressuscitant des items) — régression classe BUG-034.
5. Reste ÉLEVÉ puis MOYEN.

> Rappel flow projet (`.ai/`, `CLAUDE.md`) : pour chaque correction → test de non-régression obligatoire + `npm run validate` avant commit. Mettre à jour ce fichier (`OUVERT` → `CORRIGÉ`) à chaque fix, et reporter dans `AUDIT_BUGS.md`.
