# 🚀 Setup Logging Swipe - Résumé Rapide

## Fichiers ajoutés/modifiés

✅ **`debugConfig.ts`** - Flag d'activation du logging  
✅ **`debugSwipeLogger.ts`** - Système de logging complet avec fichier local  
✅ **Logs ajoutés** dans `stock.tsx`, `stockRemoval.ts`, `stockStore.ts`  
✅ **Dépendances** - `expo-file-system`, `expo-sharing` installées  
✅ **Tous les tests passent** ✓

---

## ⚡ Workflow rapide pour capturer le bug

### 1️⃣ Activer les logs
Éditer `frontend/utils/debugConfig.ts` ligne 6:
```typescript
export const DEBUG_SWIPE_ACTIONS = true; // ← Active les logs
```

### 2️⃣ Relancer l'app
```bash
npm start
```
Appuyer sur `r` pour recharger si l'app est déjà lancée.

### 3️⃣ Reproduire le bug
- Aller à l'écran **Stock**
- Swiper le 1er article → ✅ Disparaît
- Swiper le 2e article → ❌ Ne disparaît pas?

### 4️⃣ Récupérer les logs

Dans la console JavaScript de l'app, exécute:

```javascript
// Étape A: S'assurer que le fichier est à jour
window.__KEEPEAT_DEBUG_LOGS__.flush();

// Étape B: Partager le fichier
await window.__KEEPEAT_DEBUG_LOGS__.shareFile();
```

**Une feuille de partage apparaît** → envoie par Mail/Messages/etc.

---

## 📁 Où ça va?

**Chemin du fichier:** `Téléchargements/keepeat_swipe_logs_YYYY-MM-DD_HH-MM-SS.txt`

Exemple: `Téléchargements/keepeat_swipe_logs_2026-05-10_14-23-15.txt`

> 📝 Si l'app n'a pas accès à Téléchargements, elle crée le fichier en fallback dans le dossier interne de l'app.

---

## 🔧 Autres commandes utiles

```javascript
// Voir le chemin exact du fichier
console.log(window.__KEEPEAT_DEBUG_LOGS__.filePath());

// Vérifier si le fallback a été utilisé
console.log(window.__KEEPEAT_DEBUG_LOGS__.isFallback());

// Lire le contenu du fichier directement
const logs = await window.__KEEPEAT_DEBUG_LOGS__.readFile();
console.log(logs);

// Effacer les logs (recommencer du zéro)
await window.__KEEPEAT_DEBUG_LOGS__.clearFile();
```

---

## ⚠️ Désactiver après debugging

Éditer `frontend/utils/debugConfig.ts` et revenir à:
```typescript
export const DEBUG_SWIPE_ACTIONS = false; // ← Désactive les logs
```

Relancer l'app. Cela élimine le code de logging à la compilation (zéro impact perfo).

---

## 📊 Que contiennent les logs?

Chaque log a ce format:

```
[2026-05-10T14:23:15.234Z] [INFO] [StockScreen.onSwipeableLeftOpen] Swiped left
  {"itemId":"abc-123","itemName":"Pomme","queueSize":"pending"}

[2026-05-10T14:23:15.456Z] [INFO] [removeStockItems] Starting removal
  {"itemIds":["abc-123"],"uniqueIds":["abc-123"],"action":"used",...}

[2026-05-10T14:23:15.789Z] [INFO] [stockStore.markConsumed] Optimistic update applied
  {"itemId":"abc-123","newStoreItemsCount":4}

[2026-05-10T14:23:16.123Z] [INFO] [stockStore.markConsumed] API POST succeeded
  {"itemId":"abc-123"}
```

---

## 🎯 Points clés à observer

Quand tu m'envoies les logs, cherche notamment:

- **Temps exact** des deux swipes
- **Résultat de removeStockItems** (removedItemsCount, failedCount) pour chaque item
- **Erreurs API** (errMsg, errStatus)
- **Rollbacks** (si le POST échoue)
- **État du store** (storeItemsCount) à chaque étape
- **Pourquoi le 2e item échoue** (stillActive? notFound? failedCount?)

---

## ❓ Problèmes?

**Q: Je vois l'erreur "Could not write to Download folder"?**  
A: C'est normal! C'est un fallback. Le fichier est créé dans le dossier interne de l'app à la place. Vérifie avec `isFallback()`.

**Q: Le fichier n'existe pas?**  
A: Vérifie le chemin avec `filePath()`. S'il a aucun contenu, c'est que les logs n'ont pas été écrits encore. Laisse l'app tourner quelques secondes.

**Q: Je veux réactiver les logs après les avoir désactivés?**  
A: Remets juste `DEBUG_SWIPE_ACTIONS = true` et relance l'app!

---

Bon debugging! 🔍
