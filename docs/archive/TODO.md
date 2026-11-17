# TODO

## Priorité moyenne

- [x] Reprendre plus tard l'implémentation end-to-end des images pour les articles issus de l'analyse de ticket de caisse (enrichissement backend OCR, mapping API, persistance stock, rendu UI, monitoring admin). — Fait le 2026-08-18 : recherche OpenFoodFacts par nom (`search_openfoodfacts_by_name`), câblée dans `ocr_receipt()` (chemin OCR direct) et `process_receipt_ticket` (saisie admin manuelle), image affichée sur l'écran de confirmation du scan ticket, indicateur de taux de succès sur le dashboard admin (`ocr_image_enrichment`).
