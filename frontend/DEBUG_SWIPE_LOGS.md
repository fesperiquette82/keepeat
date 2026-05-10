# 🔍 Guide de Debugging - Logs de Swipe

## Activation des logs

Les logs de swipe sont **désactivés par défaut** pour éviter tout impact performance.

### Étape 1: Activer le flag DEBUG
Ouvrir le fichier `frontend/utils/debugConfig.ts` et changer:

```typescript
// 🔴 MODIFIER CETTE VALEUR POUR ACTIVER/DÉSACTIVER LES LOGS
export const DEBUG_SWIPE_ACTIONS = false; // ← Change to true to enable
```

En:

```typescript
export const DEBUG_SWIPE_ACTIONS = true; // ← Logs enabled
```

### Étape 2: Relancer l'app
```bash
cd frontend
npm start
```

Ou si l'app est déjà en cours d'exécution, appuyer sur `r` dans le terminal Metro pour recharger.

---

## 📁 Où vont les logs?

Les logs vont **automatiquement** dans le dossier **Téléchargements (Download)** de ton téléphone Android:

**Chemin:** `Téléchargements/keepeat_swipe_logs_YYYY-MM-DD_HH-MM-SS.txt`

Exemple: `Téléchargements/keepeat_swipe_logs_2026-05-10_14-23-15.txt`

**Chaque session crée un nouveau fichier** (avec timestamp) pour faciliter le suivi.

Les logs s'écrivent **automatiquement** toutes les 3 secondes. Zéro manipulation nécessaire!

> 📝 **Note:** Si pour une raison quelconque l'app n'a pas accès au dossier Téléchargements, un fallback automatique utilise le dossier interne de l'app. Tu verras un warning dans la console.

### Plus spécifiquement:

1. **Buffer en mémoire** (500 derniers logs)
   - Mis à jour en temps réel lors de chaque action

2. **Fichier local** (`keepeat_debug_logs.txt`)
   - Écrit automatiquement toutes les 3 secondes
   - Persistent (survit à un redémarrage de l'app)

3. **Console** (Terminal Metro)
   - Affichage optionnel en temps réel

---

## 📱 Comment récupérer les logs (Facile!)

### Étape 1: Forcer l'écriture du fichier

Ouvrir la console JavaScript de l'app (DevTools) et exécuter:

```javascript
// Force l'écriture du fichier immédiatement
await window.__KEEPEAT_DEBUG_LOGS__.flush();
```

### Étape 2: Vérifier le chemin (optionnel)

Tu peux vérifier où le fichier a été créé:

```javascript
// Voir le chemin complet
console.log(window.__KEEPEAT_DEBUG_LOGS__.filePath());

// Vérifier si le fallback a été utilisé
console.log(window.__KEEPEAT_DEBUG_LOGS__.isFallback());
```

### Étape 3: Partager le fichier

Toujours dans la console:

```javascript
// Partage le fichier via Mail, Messages, etc.
await window.__KEEPEAT_DEBUG_LOGS__.shareFile();
```

Une feuille de partage s'ouvre → choisis comment envoyer le fichier (Mail, Messages, etc.)

---

## 🔎 Vérifier le chemin du fichier

Pour voir exactement où le fichier a été créé, exécute dans la console:

```javascript
// Voir le chemin du fichier (principal)
console.log(window.__KEEPEAT_DEBUG_LOGS__.filePath());

// Voir le fallback path (s'il a été utilisé)
// (Cette info est dans les logs console au démarrage)
```

Cela affichera quelque chose comme:
```
/storage/emulated/0/Download/keepeat_swipe_logs_2026-05-10_14-23-15.txt
```

---

## 🎮 Fonctions disponibles

Une fois l'app lancée avec les logs activés, vous pouvez exécuter ces commandes:

```javascript
// FICHIER LOCAL
// ============

// Voir le chemin du fichier
window.__KEEPEAT_DEBUG_LOGS__.filePath();

// Vérifier si le fallback a été utilisé
window.__KEEPEAT_DEBUG_LOGS__.isFallback();

// Lire le contenu du fichier
const content = await window.__KEEPEAT_DEBUG_LOGS__.readFile();
console.log(content);

// Partager le fichier (Mail, Messages, etc.)
await window.__KEEPEAT_DEBUG_LOGS__.shareFile();

// Vider le fichier et redémarrer
await window.__KEEPEAT_DEBUG_LOGS__.clearFile();

// Forcer l'écriture immédiate dans le fichier
window.__KEEPEAT_DEBUG_LOGS__.flush();  // Note: synchrone, pas d'await

// BUFFER EN MÉMOIRE
// =================

// Exporter tous les logs en JSON
window.__KEEPEAT_DEBUG_LOGS__.export();

// Exporter en texte formaté
window.__KEEPEAT_DEBUG_LOGS__.exportText();

// Voir le nombre de logs en mémoire
window.__KEEPEAT_DEBUG_LOGS__.count();

// Effacer le buffer mémoire
window.__KEEPEAT_DEBUG_LOGS__.clear();

// Toggle des logs (désactiver/réactiver dynamiquement)
window.__KEEPEAT_DEBUG_LOGS__.toggle(false); // Désactiver
window.__KEEPEAT_DEBUG_LOGS__.toggle(true);  // Réactiver
```

---

## 📋 Format des logs

Chaque log contient:

- **timestamp** - Heure ISO (ex: `2026-05-10T14:23:15.234Z`)
- **level** - `INFO`, `WARN`, ou `ERROR`
- **module** - Le fichier/composant (ex: `StockScreen.handleSwipeAction`)
- **action** - Description de ce qui se passe
- **details** - Données structurées (JSON)

Exemple dans le fichier:
```
[2026-05-10T14:23:15.234Z] [INFO] [StockScreen.onSwipeableLeftOpen] Swiped left
  {"itemId":"abc-123","itemName":"Pomme","queueSize":"pending"}

[2026-05-10T14:23:15.456Z] [INFO] [StockScreen.handleSwipeAction] Starting for item=abc-123 action=used
  {"itemId":"abc-123","action":"used","isProcessing":false}
```

---

## 🐛 Workflow complet: Capturer les logs du bug

### Avant de tester:
1. ✅ Éditer `frontend/utils/debugConfig.ts` et faire `DEBUG_SWIPE_ACTIONS = true`
2. ✅ Relancer l'app (`npm start`)

### Pendant le test:
3. ✅ Aller à l'écran **Stock**
4. ✅ **Glisser le 1er article** vers la gauche/droite → animation de suppression
5. ✅ **Attendre ~1 seconde** puis glisser le 2e article immédiatement après
6. ✅ Observer si le 2e article ne se supprime pas

### Après le test:
7. ✅ Dans la console JS, exécuter:
   ```javascript
   await window.__KEEPEAT_DEBUG_LOGS__.flush();
   ```
   (Cela force l'écriture du fichier)

8. ✅ Toujours dans la console, exécuter:
   ```javascript
   await window.__KEEPEAT_DEBUG_LOGS__.shareFile();
   ```
   Une feuille de partage apparaît → envoie le fichier par Mail, Messages, etc.

---

## ⚠️ Désactivation

Après debugging, **toujours désactiver** les logs:

```typescript
export const DEBUG_SWIPE_ACTIONS = false;
```

Relancer l'app. Cela élimine le code de logging à la compilation (tree-shaking) et restaure les performances nominales.

---

## 📝 Ce que je vais analyser

Quand tu envoies les logs, je vais chercher:

- ✅ **Timing exact** des deux swipes
- ✅ **Résultat de `removeStockItems`** pour chaque item (`removedItemsCount`, `failedCount`)
- ✅ **Erreurs API** (`errMsg`, `errStatus`)
- ✅ **Rollback** (quand `markConsumed` ou `markThrown` échoue)
- ✅ **État du store** (`storeItemsCount`) à chaque étape
- ✅ **Motif de l'échec** pour le 2e item (stillActive? notFound? failedCount?)

---

## 🆘 Problèmes?

Si tu as une erreur lors du partage, tu peux aussi lire le fichier directement:

```javascript
const content = await window.__KEEPEAT_DEBUG_LOGS__.readFile();
console.log(content);  // Affiche le contenu en console
```

Puis copie-colle le résultat.

