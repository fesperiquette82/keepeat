# Frontend Admin Monitoring (KeepEat)

## Routes ajoutées
- `/admin`
- `/admin/monitoring` (dashboard)
- `/admin/monitoring/apis`
- `/admin/monitoring/users`
- `/admin/monitoring/subscriptions`
- `/admin/monitoring/services-usage`
- `/admin/monitoring/events`

## Sécurité côté frontend
- Guard central dans `frontend/app/admin/_layout.tsx`.
- Utilise `isAdminUser(...)` (`frontend/utils/adminAccess.ts`) basé sur `EXPO_PUBLIC_ADMIN_EMAILS`.
- Fallback debug: accès admin autorisé en variant `debug` si aucune whitelist n’est fournie.
- Si non autorisé: redirection vers `/settings`.
- Important: ce guard reste ergonomique. La sécurité réelle est contrôlée par le backend.

## Couche API monitoring
- `frontend/utils/adminMonitoringApi.ts`
- Endpoints backend consommés:
  - `GET /api/admin/monitoring/health`
  - `GET /api/admin/monitoring/dashboard`
  - `GET /api/admin/monitoring/apis`
  - `GET /api/admin/monitoring/users`
  - `GET /api/admin/monitoring/subscriptions`
  - `GET /api/admin/monitoring/services-usage`
  - `GET /api/admin/monitoring/events`
- Auth admin API: `Authorization: Bearer <token utilisateur>` uniquement.
- Aucun secret admin public (`EXPO_PUBLIC_ADMIN_MONITORING_KEY`) n’est utilisé.

## Composants UI réutilisables
- `frontend/component/admin/AdminUi.tsx`:
  - `AdminScaffold`, `KpiCard`, `StatusBadge`, `AdminSectionCard`
  - `LoadingState`, `ErrorState`, `EmptyState`
  - formatters (`formatMoney`, `formatMs`, `formatPct`, `formatDate`)
- `frontend/component/admin/AdminMonitoringNav.tsx` pour la navigation entre vues.

## États gérés
- Chaque vue gère loading / error / empty.
- Vue events: pagination + filtres simples (`event_name`, `event_category`, période).
- Vue APIs/services: filtres période rapides (`24h/7d/30d` ou `7d/30d`).

## Limites actuelles
- UI table simplifiée en listes structurées (pas de tri colonne avancé).
- La sécurité finale reste côté backend (rôle/whitelist serveur), le guard frontend est un complément UX.
- Les tests frontend ajoutés sont des tests unitaires utilitaires (nécessitent config runner du projet si non active).
