# Analyse de la taille Android (APK/AAB) — KeepEat

_Date de l'analyse: 2026-03-29_

## 1) Constats mesurés (repo + export Android JS/assets)

### 1.1 Artefacts et mesures disponibles
- Le projet mobile est en workflow Expo managé (pas de dossier `android/` versionné dans le repo), donc la configuration release native est principalement pilotée par `app.json` + plugins Expo.  
- Mesure locale effectuée via `npx expo export --platform android` (bundle Hermes + assets), qui donne:
  - bundle JS Hermes Android (`.hbc`): **~6.13 MB**
  - export total JS+assets: **~11 MB**
- Ces chiffres **n'incluent pas** les bibliothèques natives `.so` de l'APK/AAB final (donc ce n'est pas une taille Play finale).

### 1.2 Sources probables du poids
1. **Bundle JS/Hermes**: ~6.13 MB (part principale observée côté JS).  
2. **Fonts vector-icons**: plusieurs polices embarquées automatiquement (`MaterialCommunityIcons`, `Ionicons`, `FontAwesome*`, etc.), pour un total de plusieurs MB.  
3. **Image de branding**: `assets/images/branding/keepeat-logo.png` ~1.12 MB, réutilisée comme icon/adaptive/splash/notification.  
4. **Natif (non mesuré ici)**: dépendances caméra + OCR ML Kit + reanimated + webview + notifications susceptibles d'ajouter un coût natif significatif.

## 2) Représentativité de la taille (APK universel vs Play)

### Ce qui est mesuré ici
- `expo export` mesure bien le payload JS + assets livré embarqué, utile pour identifier le poids JavaScript/ressources packagées.

### Ce qui n'est pas représentatif Play Store
- Pas d'AAB release analysé (`bundleRelease`) avec split ABI/language/density Play.
- Pas d'APK universel release inspecté (`assembleRelease`) pour isoler le coût natif réel.

### Conclusion
- La mesure actuelle est une **base partielle**, pas la taille Play install/download finale.

## 3) Inspection configuration Android / Expo / Gradle (depuis le repo)

### 3.1 Configuration Expo
- `newArchEnabled: true` (impact possible sur taille native selon modules).  
- Permissions Android larges (dont exact alarm + notifications + camera).  
- Plugin `expo-build-properties` présent, mais sans options de shrink/minify explicitement configurées.  
- `expo-notifications`, `expo-camera`, `expo-image-manipulator`, `expo-secure-store`, etc. sont activés.

### 3.2 Hermes
- Hermes est actif (bundle `.hbc` observé à l'export Android).

### 3.3 Minify / shrinkResources / packaging natif
- Aucune clé explicite dans la config repo pour forcer/valider `android.enableMinifyInReleaseBuilds` et `android.enableShrinkResourcesInReleaseBuilds`.
- Sans build release natif inspecté, il faut confirmer via artefacts Gradle générés.

## 4) 5 optimisations les plus rentables (safe-first)

## Priorité 1 — Réduire l'empreinte des icônes (`@expo/vector-icons`)  
- **Impact estimé**: **Élevé** (souvent 2–4 MB gagnables en assets).  
- **Risque**: **Faible**.  
- **Effort**: **Moyen**.  
- **Action sûre**: n'utiliser qu'un set d'icônes minimal (ex. Ionicons only) et éviter l'embarquement de familles non utilisées.

## Priorité 2 — Optimiser les images de branding (PNG -> WebP/PNG optimisé)  
- **Impact estimé**: **Moyen à élevé** (logo actuel ~1.12 MB, utilisé à plusieurs endroits).  
- **Risque**: **Très faible** si validation visuelle.  
- **Effort**: **Faible**.  
- **Action sûre**: recompression lossless/near-lossless + dimensions strictement nécessaires pour icon/splash.

## Priorité 3 — Confirmer et activer explicitement minify + shrinkResources en release  
- **Impact estimé**: **Moyen** (ressources Android + bytecode Java/Kotlin).  
- **Risque**: **Faible à moyen** (règles keep éventuelles).  
- **Effort**: **Faible**.  
- **Action sûre**: activer progressivement, tester parcours critiques, ajouter règles `-keep` minimales si besoin.

## Priorité 4 — Vérifier format de livraison Play (AAB + splits) plutôt qu'APK universel  
- **Impact estimé**: **Élevé côté taille téléchargée utilisateur**.  
- **Risque**: **Nul** (changement de pipeline, pas fonctionnel).  
- **Effort**: **Faible**.  
- **Action sûre**: mesurer AAB release et comparer au scénario APK universel qui surestime la taille.

## Priorité 5 — Audit dépendances natives réellement nécessaires (camera/OCR/webview/notifications)
- **Impact estimé**: **Moyen à élevé** (si une dépendance lourde est retirée).  
- **Risque**: **Moyen** (fonctionnalité liée).  
- **Effort**: **Moyen**.  
- **Action sûre**: commencer par audit d'usage réel; ne retirer qu'une dépendance non utilisée.

## 5) Sans risque vs compromis taille/performance

### Sans risque (phase 1)
- Optimisation d'assets statiques (compression/resize) avec QA visuelle.
- Validation du format de build (AAB Play vs APK universel).
- Mesure outillée systématique (sans changer le runtime).
- Réduction des packs d'icônes inutilisés.

### Avec compromis possible
- Désactivation New Architecture: peut réduire/augmenter selon stack et impacter perf/compatibilité.
- Changement Hermes <-> JSC: compromis taille/perf/démarrage.
- Retrait de libs natives: gain taille contre perte fonctionnelle potentielle.

## 6) Commandes recommandées pour confirmer précisément

### Mesure JS/assets
```bash
cd frontend
npx expo export --platform android --output-dir dist-export --dump-assetmap
```

### Mesure native release représentative
```bash
# Build AAB release (EAS ou Gradle selon pipeline)
# puis analyser:
# - Android Studio > Build > Analyze APK (ou AAB)
# - bundletool get-size total
```

### Contrôles utiles
```bash
# 1) Vérifier activation minify/shrink dans build release généré
# 2) Vérifier ABI réellement livrées
# 3) Lister top fichiers .so/.arsc/assets
```

## 7) Fichiers inspectés
- `frontend/app.json`
- `frontend/app.config.js`
- `frontend/package.json`
- `frontend/metro.config.js`

## 8) Lot 1 implémenté (optimisations sûres)

### Changements appliqués
- Standardisation des imports d'icônes vers `@expo/vector-icons/Ionicons` (au lieu de l'import agrégé), pour éviter d'embarquer des familles non utilisées.
- Remplacement du logo branding 1024 (1.12 MB) par `assets/images/icon.png` (512, 252 KB) pour les usages UI React Native (logo écrans/animations), sans toucher les assets natifs de branding utilisés par la config Expo.
- Activation explicite de `enableMinifyInReleaseBuilds` et `enableShrinkResourcesInReleaseBuilds` via `expo-build-properties`.
- Ajout d'une note de mesure release fiable dans `frontend/README.md`.

### Mesure comparative (export Android JS/assets)
- Avant lot 1 (audit):
  - bundle Hermes: ~6.13 MB
  - export JS+assets: ~11 MB
  - assets: 44 (dont nombreuses fonts vector-icons)
- Après lot 1:
  - bundle Hermes: ~5.78 MB
  - export JS+assets: ~6.3 MB
  - assets: 26 (Ionicons uniquement côté vector-icons)

> Important: ces mesures restent partielles (JS/assets). La taille Play finale doit être confirmée sur AAB release.
