# Scripts de maintenance KeepEat

Ce répertoire contient des scripts de maintenance pour la base de données KeepEat.

## restore_images_from_openfoodfacts.py

Script de récupération des images depuis l'API Open Food Facts pour restaurer les URLs d'images corrompues dans la base de données.

### Problème résolu

Certains items en stock peuvent avoir des URLs d'images corrompues (chaînes vides, espaces uniquement, ou `null`). Ce script récupère les vraies images depuis Open Food Facts pour les produits qui ont un barcode.

### Prérequis

```bash
pip install motor httpx
```

### Variables d'environnement

- `MONGODB_URI` : URI de connexion MongoDB (défaut: `mongodb://localhost:27017`)
- `DB_NAME` : Nom de la base de données (défaut: `keepeat`)

### Usage

#### Mode dry-run (recommandé pour tester d'abord)

```bash
python backend/scripts/restore_images_from_openfoodfacts.py --dry-run
```

Ce mode affiche ce qui serait fait sans modifier la base de données.

#### Mode normal (applique les modifications)

```bash
python backend/scripts/restore_images_from_openfoodfacts.py
```

### Exemple de sortie

```
============================================================
🖼️  RESTAURATION DES IMAGES DEPUIS OPEN FOOD FACTS
============================================================

🔍 Connexion à MongoDB...
📊 Analyse de la collection stock...
✓ 150 items trouvés en stock

✓ 120 items ont un barcode
✓ 85 items ont besoin d'une image

🚀 DÉMARRAGE de la récupération des images...

[1/85] Lait demi-écrémé (barcode: 3256220881616)
  ✓ Image trouvée: https://images.openfoodfacts.org/images/products/325/622/...
  ✓ Image mise à jour dans MongoDB

[2/85] Yaourt nature (barcode: 3029330003533)
  ✓ Image trouvée: https://images.openfoodfacts.org/images/products/302/933/...
  ✓ Image mise à jour dans MongoDB

[3/85] Produit inconnu (barcode: 1234567890123)
  ⚠️ Aucune image disponible sur Open Food Facts

...

============================================================
📊 STATISTIQUES FINALES
============================================================
Total items en stock:           150
Items avec barcode:             120
Items nécessitant une image:    85
Images trouvées:                72
Images non trouvées:            13
Images mises à jour:            72
Erreurs:                        0
============================================================

✅ Récupération terminée !
```

### Notes

- Le script ajoute une pause de 0.5s entre chaque requête pour ne pas surcharger l'API Open Food Facts
- Les URLs HTTP sont automatiquement converties en HTTPS
- Le script essaie plusieurs champs d'image par ordre de préférence : `image_url`, `image_front_url`, `image_small_url`, `image_thumb_url`
- Seuls les items avec `status: "active"` sont traités

### Dépannage

Si le script échoue avec une erreur de connexion MongoDB :

1. Vérifiez que MongoDB est démarré
2. Vérifiez la variable d'environnement `MONGODB_URI`
3. Vérifiez que vous avez les permissions nécessaires

Si beaucoup d'images ne sont pas trouvées :

- C'est normal pour les produits non référencés sur Open Food Facts
- Les produits sans barcode ne peuvent pas être traités
- Certains barcodes peuvent être invalides ou mal formatés
