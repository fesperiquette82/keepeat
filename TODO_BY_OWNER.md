# TODO — Actions côté propriétaire

> Actions qui ne peuvent pas être faites par un agent de développement : comptes
> externes, domaines, tests en conditions réelles, décisions juridiques. Le code
> correspondant est déjà écrit et testé (unitairement) côté dépôt — voir
> `AUDIT_BUGS.md` pour le détail technique de chaque point.

---

## 🔴 Urgent / bloquant avant une vraie mise en production

- [x] **Politique de confidentialité** — correction du 21/08 : elle existait déjà en fait (`/privacy-policy`, ajoutée lors d'une session précédente — BUG-036), une affirmation antérieure disant le contraire était erronée. Mise à jour pour couvrir le foyer partagé et l'import de tickets par email (BUG-052), et un lien y est désormais visible dans Réglages → Compte. Rien à faire de ton côté sur ce point.
- [ ] **CGU / mentions légales** — ce document-là, en revanche, n'existe vraiment pas. Contenu propre à ton activité (identité de l'exploitant, statut juridique, conditions de facturation, responsabilité) que je ne peux pas rédiger sans toi — dis-moi si tu veux qu'on s'y attelle.
- [x] **Positionner `GEMINI_RECIPES_MODEL` et `GEMINI_OCR_MODEL` sur Render** — fait le 2026-08-21 (`gemini-3.5-flash-lite` sur les deux variables).
- [ ] **Tester un vrai achat premium** — `startPurchase()` (point 01) est câblé et testé unitairement, mais jamais validé en conditions réelles (pas de build natif Android disponible dans l'environnement de développement). À tester sur un appareil/émulateur Android avec le SKU `premium_monthly` configuré sur Google Play Console.

## 🟢 Partager l'app à des amis + leur donner le premium gratuitement

- [ ] **Distribuer l'app** — depuis `frontend/`, lancer `eas build --platform android --profile preview` (profil déjà configuré dans `eas.json`). Ça génère un lien + QR code à partager directement — pas besoin du Play Store, pas de compte testeur à créer.
- [ ] **Chaque ami crée un compte** dans l'app (email + mot de passe, vérification email) avant que tu puisses lui donner le premium.
- [ ] **Vérifier que ton email est bien dans `ADMIN_EMAILS` sur Render** — confirmé par toi : c'est déjà le cas. C'est ce qui te donne les droits admin, **pas** une clé séparée : il n'existe aucune variable `ADMIN_KEY`/`ADMIN_TOKEN` dans ce projet. Le contrôle se fait uniquement sur l'email du compte connecté.
- [ ] **Récupérer ton "token admin"** — ce n'est pas une valeur Render, c'est le jeton que l'API te renvoie quand tu te connectes avec TON compte (le même que dans l'app). Depuis un terminal :
  ```bash
  curl -X POST "https://<url-backend>/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email": "ton_email@exemple.com", "password": "ton_mot_de_passe"}'
  ```
  La réponse contient `"access_token": "eyJ..."` — c'est ce jeton (valable un temps limité) qu'il faut réutiliser à l'étape suivante.
- [ ] **Activer le premium pour un ami** (répéter pour chaque ami, une fois qu'il a créé son compte) :
  ```bash
  curl -X PUT "https://<url-backend>/api/admin/users/email_ami@exemple.com/set-premium?premium=true" \
    -H "Authorization: Bearer <access_token_récupéré_ci-dessus>"
  ```
  Réponse attendue : `{"ok": true, "email": "email_ami@exemple.com", "is_premium": true}`. Pas de limite de durée — reste actif jusqu'à ce que tu le désactives (`premium=false`) ou que le compte soit supprimé.

## 🟠 Pour activer l'import de tickets par email (BUG-051/054)

Simplifié le 23/08 (à ta demande) : plus de domaine à acheter ni de DNS à configurer — une seule boîte mail suffit, et l'app la relève elle-même toutes les 30 min entre ~8h et ~22h heure de Paris (coupé la nuit, personne n'envoie de ticket à 3h du matin), pas de webhook à mettre en place.

- [x] **Créer un compte email dédié** — fait le 24/08 : `keepeatfe@gmail.com`.
- [x] **Activer la validation en 2 étapes + générer un mot de passe d'application** — fait le 24/08.
- [x] **Renseigner sur Render** (`EMAIL_IMPORT_INBOX_ADDRESS`, `EMAIL_IMPORT_INBOX_APP_PASSWORD`, `EMAIL_IMPORT_CRON_TOKEN`) — posé via l'API Render le 24/08, service `keepeat-backend` redéployé (déploiement `dep-da6174m417fc7390p55g`, live).
- [x] **Ajouter le secret GitHub Actions `EMAIL_IMPORT_CRON_TOKEN`** — fait le 24/08. Le cron tourne bien (`processed=20` sur le premier run), mais **les 20 emails traités ont tous été rejetés « expéditeur non reconnu »** (logs Render) — probablement les emails automatiques de création du compte `keepeatfe@gmail.com`, ou le ticket de test envoyé depuis une adresse ne correspondant pas exactement à l'email du compte KeepEat. Voir le point suivant.
- [ ] **Réessayer un email de test transféré** depuis l'adresse EXACTE de ton compte KeepEat (le mail forwardé doit avoir cette adresse en expéditeur `From:`), et vérifier dans l'app que les articles remontent bien dans le stock (nécessite un compte premium).

## 🟡 Optionnel — seulement si l'import Gmail (BUG-050) est relancé un jour

- [ ] Créer un projet Google Cloud + client OAuth, faire vérifier le scope `gmail.readonly` par Google (audit de sécurité tiers CASA au-delà d'un certain volume d'utilisateurs), renseigner `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` + `GMAIL_TOKEN_ENCRYPTION_KEY`. Le code existe déjà (phase 1, `backend/gmail_oauth_service.py`), juste non lié depuis les réglages de l'app.
- [ ] Une vraie DPIA (analyse d'impact) menée par une personne qualifiée (DPO ou conseil externe) si le projet va jusqu'à la phase 2 (lecture automatisée de boîtes mail).

## ⚪ Jamais traité dans cette session

- [ ] **Point 03 — support iOS** : l'app est Android-only actuellement (`Platform.select` en dur dans le code d'achat premium). Décision du 21/08 : pas prioritaire pour le moment.

---

*Dernière mise à jour : 2026-08-25, après activation de l'import de tickets par email (secret GitHub ajouté, test réel à refaire) et réparation des crons Alerts/Health Check (BUG-057, aucune action de ta part nécessaire sur ce point).*
