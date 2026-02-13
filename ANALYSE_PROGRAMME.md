# Analyse du programme KeepEat

## Vue d’ensemble
KeepEat est structuré en deux parties :
- **Backend FastAPI + MongoDB** (`backend/server.py`) qui expose les API métier (`/api/stock`, `/api/stats`, `/api/product/{barcode}`, `/api/ocr/date`).
- **Frontend Expo/React Native** (`frontend/app/*`) qui consomme ces API via un store Zustand (`frontend/store/stockStore.ts`).

Le flux principal est cohérent : scan d’un code-barres → récupération produit (OpenFoodFacts) → ajout au stock → suivi péremption et actions « consommé / jeté ».

## Architecture et fonctionnement
### Backend
- Démarrage bloquant si `MONGO_URL` absent (bonne pratique de fail-fast). 
- Sérialisation Mongo propre (`_id` converti en `id`).
- API stock complète pour ajout/liste/changement de statut.
- API stats calculées côté serveur (évite des calculs lourds côté mobile).
- Intégration OpenFoodFacts avec timeout + `User-Agent` configurable.
- OCR date optionnel avec fallback propre (`501` si dépendances absentes).

### Frontend
- Navigation par `expo-router`.
- État global métier via Zustand (`items`, `priorityItems`, `stats`, actions API).
- Écran d’accueil clair (stats + priorités + liste globale).
- Écran scan avec caméra + saisie manuelle.
- Internationalisation simple FR/EN via store local + persistance AsyncStorage.

## Points forts
1. **Bonne séparation des responsabilités** entre API, stockage et UI.
2. **Endpoints utiles et pragmatiques** pour un MVP anti-gaspillage (priorités, stats hebdo, actions rapides).
3. **Résilience acceptable** sur les services externes (OpenFoodFacts et OCR gérés sans faire crasher toute l’app).
4. **UX orientée action** : scanner, ajouter, marquer consommé/jeté rapidement.

## Risques / incohérences repérés
1. **Script de test backend obsolète** : `backend_test.py` teste des routes `GET /stock/{id}` et `PUT /stock/{id}` qui n’existent pas dans `backend/server.py`.
2. **Concurrence du loader côté frontend** : `fetchStock`, `fetchPriorityItems`, `fetchStats` modifient tous `isLoading`, ce qui peut provoquer des transitions visuelles incohérentes quand lancés en parallèle.
3. **Clés de traduction manquantes** : l’écran d’ajout utilise notamment `t('productAdded')` et `t('selectDate')` sans définitions visibles dans `languageStore` (affichage probable de la clé brute).
4. **Sécurité API** : pas d’authentification/autorisation sur les endpoints stock (acceptable en prototype, risqué en production).
5. **CORS permissif (`*`) par défaut** et aucune limite de débit sur OCR/lookup externe.
6. **Validation métier légère** : peu de garde-fous sur formats/sizes (ex. payload OCR base64 potentiellement volumineux).

## Recommandations prioritaires
### Priorité haute (fiabilité / production)
- Ajouter **authentification** (JWT + notion d’utilisateur) et filtrage des données par utilisateur.
- Corriger ou retirer les tests obsolètes de `backend_test.py` pour les aligner sur les routes réellement exposées.
- Introduire une stratégie de **loading granulaire** côté frontend (`isLoadingStock`, `isLoadingStats`, etc.).

### Priorité moyenne (qualité produit)
- Compléter les traductions manquantes et centraliser les clés i18n.
- Ajouter des validations plus strictes (taille image OCR, format barcode, longueur des champs texte).
- Ajouter index Mongo utiles (`status`, `expiry_date`, éventuellement `added_date`) pour la montée en charge.

### Priorité basse (évolutivité)
- Normaliser le logging structuré avec correlation id.
- Ajouter tests automatisés backend (pytest + httpx async + DB de test).
- Introduire monitoring basique (latence API, taux d’erreurs OCR/OFF).

## Conclusion
Le programme est **bien structuré pour un MVP** et couvre correctement le besoin métier principal (réduction du gaspillage alimentaire). 
La base est saine, mais avant une mise en production large, il faut surtout renforcer **sécurité**, **alignement des tests**, et **robustesse des états frontend**.
