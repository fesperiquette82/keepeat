# Instructions Claude Code — KeepEat

> Ce fichier est lu automatiquement par Claude Code à chaque session.
> Ces règles sont OBLIGATOIRES et s'appliquent à TOUS les développements sans exception.

---

## ⚠️ RÈGLE ABSOLUE — TEST DE NON-RÉGRESSION OBLIGATOIRE

**Pour chaque correction de bug ou nouvelle fonctionnalité, un test de non-régression DOIT être ajouté ou mis à jour.**

Une tâche est considérée comme **INCOMPLÈTE** tant que :
- [ ] L'implémentation n'est pas terminée
- [ ] Le test de non-régression n'a pas été écrit
- [ ] Le test ne passe pas
- [ ] **Pour toute nouvelle fonctionnalité côté application : sa vérification n'a pas été intégrée dans le dashboard admin** (monitoring, ticket, indicateur ou page dédiée selon la nature de la fonctionnalité)

**Aucune exception n'est acceptée** sauf raison technique explicitement documentée dans le commit.

### Localisation des tests

| Périmètre | Répertoire | Commande |
|---|---|---|
| Backend Python | `tests/` (pytest) | `cd backend && pytest` |
| Frontend TypeScript | `frontend/__tests__/` (node --test) | `cd frontend && npm run test` |

### Quoi tester

Tout changement sur :
- Logique d'expiration / durée de conservation
- Filtrage ou scoring des recettes
- Matching ingrédients/stock
- États vides ou fallbacks UI
- Mapping de réponses API
- Calculs de dates / KPIs

doit avoir un test couvrant exactement le cas modifié.

### Format attendu à la fin de chaque tâche

```
Fichiers modifiés : [liste]
Tests ajoutés/mis à jour : [liste avec chemin]
Commandes exécutées : [pytest / npm run test]
Résultat : [PASS / FAIL + détail si FAIL]
Risques restants : [liste ou "aucun"]
```

---

## Projet

KeepEat — application mobile anti-gaspi alimentaire.
- `frontend/` — Expo / React Native / TypeScript
- `backend/` — FastAPI / Python / MongoDB

## Gestionnaire de paquets

Utiliser `npm` uniquement (pas `yarn` ni `pnpm`).

## Méthode de travail

1. Inspecter d'abord, modifier ensuite
2. Proposer un plan court pour toute tâche complexe
3. Implémenter le plus petit patch utile
4. Réutiliser les fonctions, hooks, wrappers existants
5. **Ajouter le test avant de considérer la tâche terminée**

## Commandes

```bash
# Backend
cd backend && pip install -r requirements.txt
cd backend && pytest

# Frontend
cd frontend && npm ci
cd frontend && npm run lint
cd frontend && npm run test       # développement
cd frontend && npm run test:ci    # CI
```

## Suivi des bugs

Le fichier `AUDIT_BUGS.md` à la racine liste tous les bugs connus avec leur statut.
Mettre à jour ce fichier (`OUVERT` → `CORRIGÉ`) lors de chaque correction.

## Logs / sécurité

- Utiliser le logger central (`logger` de `utils/logger.ts` ou `app_core.py`)
- Pas de `console.log` dispersés
- Ne jamais logger secrets, tokens ou données sensibles

## Voir aussi

`AGENTS.md` — règles complémentaires pour les agents automatisés (Codex, etc.)
