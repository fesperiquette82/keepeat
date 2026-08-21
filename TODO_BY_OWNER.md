# TODO — Actions côté propriétaire

> Actions qui ne peuvent pas être faites par un agent de développement : comptes
> externes, domaines, tests en conditions réelles, décisions juridiques. Le code
> correspondant est déjà écrit et testé (unitairement) côté dépôt — voir
> `AUDIT_BUGS.md` pour le détail technique de chaque point.

---

## 🔴 Urgent / bloquant avant une vraie mise en production

- [ ] **Politique de confidentialité** — n'existe nulle part dans l'app actuellement (constat de la revue RGPD, BUG-050/051). À rédiger et publier, avec un lien accessible depuis l'app. Nécessaire de toute façon pour le Play Store, indépendamment de l'import mail.
- [ ] **Vérifier `GEMINI_RECIPES_MODEL` sur Render** — le modèle par défaut codé en dur (`gemini-2.0-flash-lite`) est mort côté Google (404 "no longer available"). Si cette variable n'est pas positionnée en production, le repli IA recettes est probablement cassé actuellement. Vérification à 2 minutes ; remplacer par `gemini-3.5-flash-lite` ou équivalent supporté si besoin.
- [ ] **Tester un vrai achat premium** — `startPurchase()` (point 01) est câblé et testé unitairement, mais jamais validé en conditions réelles (pas de build natif Android disponible dans l'environnement de développement). À tester sur un appareil/émulateur Android avec le SKU `premium_monthly` configuré sur Google Play Console.

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
