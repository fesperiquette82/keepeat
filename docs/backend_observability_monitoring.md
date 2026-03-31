# Observabilité Admin / Monitoring / Analytics (Backend KeepEat)

## Schéma de données

### `api_request_logs`
- `method`, `path`, `endpoint_key`
- `user_id` (nullable)
- `status_code`, `duration_ms`, `success`, `error_type`
- `created_at`

### `business_events`
- `user_id` (nullable)
- `event_name`, `event_category`
- `metadata_json`
- `created_at`

### `service_usage_logs`
- `user_id` (nullable)
- `service_name`, `action_name`
- `units_consumed`, `estimated_cost`
- `plan_type_at_time` (`free`, `premium`, `trial`, `admin_granted`)
- `metadata_json`
- `created_at`

### `daily_metrics`
- Table réservée pour agrégats journaliers futurs (index unique `date`).

## Endpoints admin ajoutés
Tous protégés par auth utilisateur + contrôle admin **côté serveur**.

- `GET /api/admin/monitoring/health`
- `GET /api/admin/monitoring/dashboard`
- `GET /api/admin/monitoring/apis`
- `GET /api/admin/monitoring/users`
- `GET /api/admin/monitoring/subscriptions`
- `GET /api/admin/monitoring/services-usage`
- `GET /api/admin/monitoring/events`

## Modèle de sécurité admin (V2)
- Ancien modèle (V1) : accès majoritairement basé sur une clé admin transportée côté client.
- Nouveau modèle : les endpoints admin monitoring exigent un utilisateur authentifié (`Bearer`) puis vérifient le rôle admin côté backend.
- Source de vérité admin (priorité) :
  1. `user.is_admin == true` en base,
  2. fallback whitelist `ADMIN_EMAILS` (variable d’environnement **serveur**, non publique).
- Le frontend ne transmet plus de pseudo-secret admin.

### Variables d’environnement serveur
- `ADMIN_EMAILS` (optionnel) : liste CSV d’emails admin, ex `admin@keepeat.app,ops@keepeat.app`.

## Événements métier trackés
- `user_registered`
- `onboarding_completed`
- `product_added`
- `product_updated`
- `stock_consumed`
- `recipe_generated`
- `ocr_scan_started`
- `ocr_scan_succeeded`
- `ocr_scan_failed`
- `recall_refresh_triggered`
- `premium_paywall_viewed` (si `source=paywall` sur `/api/billing/entitlements`)
- `premium_checkout_started`
- `premium_checkout_succeeded`
- `premium_restored`

## Services suivis
- OCR (`ocr/receipt`) + coût estimé configurable (`OCR_ESTIMATED_COST_EUR`)
- Génération recettes IA (`recipes/ai`) + coût estimé configurable (`AI_RECIPE_ESTIMATED_COST_EUR`)
- Refresh rappels externes (`recalls/refresh`) + coût estimé configurable (`RECALL_REFRESH_ESTIMATED_COST_EUR`)

## KPIs calculés
- Users: total, nouveaux (today/7d/30d), DAU/WAU/MAU, free vs premium
- Subscriptions: actifs, répartition plan, MRR/ARR estimés
- APIs: volume, top endpoints, plus haut taux d'erreur, plus haute latence (avg + p95)
- Services: usage par service/action, coût estimé, ventilation par plan

## Limites actuelles
- Coûts: estimations tant que la facturation réelle n'est pas intégrée.
- MRR/ARR: basé sur `PREMIUM_MONTHLY_PRICE_EUR` (défaut `4.99`).
- `/health` externe: vérifie configuration critique, pas un ping exhaustif de tous services tiers.
- Les conversions/churn fins dépendent de données subscription historiques plus détaillées.

## Compatibilité Render (gratuit / faible coût)
- Compatible Render Free : variables d’environnement serveur, logs applicatifs, health checks simples.
- Ce module ne dépend d’aucun SaaS payant obligatoire.
- Render couvre l’observabilité infra basique; KeepEat monitoring couvre l’observabilité produit/métier.

## Extensions recommandées
- Job planifié de remplissage `daily_metrics` pour dashboards lourds.
- Ajout de `request_id` corrélé logs applicatifs ↔ logs API.
- Instrumentation push/storage image dès que les appels serveurs dédiés sont centralisés.
