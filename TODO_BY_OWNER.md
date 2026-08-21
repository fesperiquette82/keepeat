# TODO — Actions côté propriétaire

> Actions qui ne peuvent pas être faites par un agent de développement : comptes
> externes, domaines, tests en conditions réelles, décisions juridiques. Le code
> correspondant est déjà écrit et testé (unitairement) côté dépôt — voir
> `AUDIT_BUGS.md` pour le détail technique de chaque point.

---

## 🔴 Urgent / bloquant avant une vraie mise en production

- [ ] **Politique de confidentialité** — n'existe nulle part dans l'app actuellement (constat de la revue RGPD, BUG-050/051). À rédiger et publier, avec un lien accessible depuis l'app. Nécessaire de toute façon pour le Play Store, indépendamment de l'import mail.
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

## 🟠 Pour activer l'import de tickets par email (BUG-051)

- [ ] Un domaine avec des enregistrements **MX** pointant vers un service d'inbound parsing — recommandé : **Brevo** (déjà intégré pour l'envoi d'emails transactionnels).
- [ ] Configurer ce domaine + la route webhook dans le tableau de bord Brevo, pointant vers `POST /api/webhooks/email-import?token=...`.
- [ ] Renseigner sur Render : `EMAIL_IMPORT_DOMAIN`, `EMAIL_IMPORT_WEBHOOK_SECRET` (commande de génération dans `backend/.env.example`).
- [ ] **Envoyer un vrai email de test transféré** une fois configuré — le format du payload webhook Brevo côté code est basé sur leur documentation publique, jamais vérifié contre un vrai envoi. À ajuster si besoin à ce moment-là (`backend/email_import_service.py`).

## 🟡 Optionnel — seulement si l'import Gmail (BUG-050) est relancé un jour

- [ ] Créer un projet Google Cloud + client OAuth, faire vérifier le scope `gmail.readonly` par Google (audit de sécurité tiers CASA au-delà d'un certain volume d'utilisateurs), renseigner `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` + `GMAIL_TOKEN_ENCRYPTION_KEY`. Le code existe déjà (phase 1, `backend/gmail_oauth_service.py`), juste non lié depuis les réglages de l'app.
- [ ] Une vraie DPIA (analyse d'impact) menée par une personne qualifiée (DPO ou conseil externe) si le projet va jusqu'à la phase 2 (lecture automatisée de boîtes mail).

## ⚪ Jamais traité dans cette session

- [ ] **Point 03 — support iOS** : l'app est Android-only actuellement (`Platform.select` en dur dans le code d'achat premium). Identifié dans l'audit commercial initial, jamais redemandé depuis — à clarifier si c'est encore dans les plans.

---

*Dernière mise à jour : 2026-08-20, à l'issue des points 07 (catalogue), 01 (achat premium), recalibrage gratuit/premium, partage foyer et import de tickets par email.*
