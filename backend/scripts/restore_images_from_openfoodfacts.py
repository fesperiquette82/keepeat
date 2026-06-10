#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de récupération des images depuis Open Food Facts

Ce script récupère les URLs d'images depuis l'API Open Food Facts pour tous
les produits en stock qui ont un barcode mais dont l'image_url est corrompue
(chaîne vide, espaces uniquement, ou null).

Usage:
    python backend/scripts/restore_images_from_openfoodfacts.py [--dry-run]

Options:
    --dry-run    Affiche ce qui serait fait sans modifier la base de données
"""

import asyncio
import os
import sys
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

# Configuration
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "keepeat")
OPENFOODFACTS_API = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
USER_AGENT = "KeepEat/1.0 (https://github.com/fesperiquette82/keepeat)"

# Statistiques
stats = {
    "total_items": 0,
    "items_with_barcode": 0,
    "items_needing_image": 0,
    "images_found": 0,
    "images_not_found": 0,
    "images_updated": 0,
    "errors": 0,
}


def is_invalid_image_url(url: Optional[str]) -> bool:
    """Vérifie si une URL d'image est invalide (vide, espaces, ou null)."""
    if url is None:
        return True
    if not isinstance(url, str):
        return True
    trimmed = url.strip()
    if not trimmed or trimmed in ("null", "undefined"):
        return True
    return False


async def fetch_image_from_openfoodfacts(barcode: str) -> Optional[str]:
    """
    Récupère l'URL de l'image depuis Open Food Facts.

    Returns:
        L'URL de l'image si trouvée, None sinon.
    """
    url = OPENFOODFACTS_API.format(barcode=barcode)
    headers = {"User-Agent": USER_AGENT}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                return None

            data = response.json()

            # Vérifier si le produit existe
            if data.get("status") != 1:
                return None

            product = data.get("product", {})

            # Essayer différents champs d'image par ordre de préférence
            image_url = (
                product.get("image_url")
                or product.get("image_front_url")
                or product.get("image_small_url")
                or product.get("image_thumb_url")
            )

            if image_url and isinstance(image_url, str) and image_url.strip():
                # Forcer HTTPS
                if image_url.startswith("http://"):
                    image_url = "https://" + image_url[7:]
                return image_url

            return None

    except Exception as e:
        print(f"  X Erreur API pour barcode {barcode}: {e}")
        stats["errors"] += 1
        return None


async def restore_images(dry_run: bool = False):
    """
    Restaure les images depuis Open Food Facts.

    Args:
        dry_run: Si True, affiche ce qui serait fait sans modifier la base.
    """
    print("🔍 Connexion à MongoDB...")
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client[DB_NAME]
    stock_col = db["stock"]

    print(f"📊 Analyse de la collection stock...")

    # Trouver tous les items avec status active
    cursor = stock_col.find({"status": "active"})
    all_items = await cursor.to_list(length=None)
    stats["total_items"] = len(all_items)

    print(f"OK {stats['total_items']} items trouvés en stock\n")

    # Filtrer les items qui ont un barcode
    items_with_barcode = [
        item for item in all_items
        if item.get("barcode") and isinstance(item.get("barcode"), str) and item["barcode"].strip()
    ]
    stats["items_with_barcode"] = len(items_with_barcode)

    print(f"OK {stats['items_with_barcode']} items ont un barcode")

    # Filtrer les items dont l'image est invalide
    items_needing_image = [
        item for item in items_with_barcode
        if is_invalid_image_url(item.get("image_url"))
    ]
    stats["items_needing_image"] = len(items_needing_image)

    print(f"OK {stats['items_needing_image']} items ont besoin d'une image\n")

    if stats["items_needing_image"] == 0:
        print("SUCCESS Aucun item à traiter !")
        return

    if dry_run:
        print("MODE DRY-RUN : Aucune modification ne sera faite\n")
    else:
        print("DEMARRAGE de la récupération des images...\n")

    # Traiter chaque item
    for i, item in enumerate(items_needing_image, 1):
        item_id = str(item["_id"])
        barcode = item["barcode"].strip()
        name = item.get("name", "Sans nom")

        print(f"[{i}/{stats['items_needing_image']}] {name} (barcode: {barcode})")

        # Récupérer l'image depuis Open Food Facts
        image_url = await fetch_image_from_openfoodfacts(barcode)

        if image_url:
            stats["images_found"] += 1
            print(f"  + Image trouvee: {image_url[:60]}...")

            if not dry_run:
                # Mettre à jour MongoDB
                result = await stock_col.update_one(
                    {"_id": item["_id"]},
                    {"$set": {"image_url": image_url}}
                )

                if result.modified_count > 0:
                    stats["images_updated"] += 1
                    print(f"  + Image mise a jour dans MongoDB")
                else:
                    print(f"  ! Echec de mise a jour MongoDB")
        else:
            stats["images_not_found"] += 1
            print(f"  - Aucune image disponible sur Open Food Facts")

        # Petite pause pour ne pas surcharger l'API
        await asyncio.sleep(0.5)
        print()

    # Afficher les statistiques finales
    print("\n" + "=" * 60)
    print("STATISTIQUES FINALES")
    print("=" * 60)
    print(f"Total items en stock:           {stats['total_items']}")
    print(f"Items avec barcode:             {stats['items_with_barcode']}")
    print(f"Items nécessitant une image:    {stats['items_needing_image']}")
    print(f"Images trouvées:                {stats['images_found']}")
    print(f"Images non trouvées:            {stats['images_not_found']}")
    if not dry_run:
        print(f"Images mises à jour:            {stats['images_updated']}")
    print(f"Erreurs:                        {stats['errors']}")
    print("=" * 60)

    if dry_run:
        print("\nINFO: Executez sans --dry-run pour appliquer les modifications")
    else:
        print("\nSUCCESS: Recuperation terminee !")

    client.close()


def main():
    """Point d'entrée du script."""
    import argparse
    import sys

    # Force UTF-8 encoding for Windows console
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="Récupère les images depuis Open Food Facts pour restaurer les URLs corrompues"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Mode simulation : affiche ce qui serait fait sans modifier la base"
    )

    args = parser.parse_args()

    print("=" * 60)
    print("RESTAURATION DES IMAGES DEPUIS OPEN FOOD FACTS")
    print("=" * 60)
    print()

    asyncio.run(restore_images(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
