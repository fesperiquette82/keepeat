"""Correspondance entre les produits du stock et les ingrédients des recettes (BUG-103).

Le serveur ne reconnaissait un produit que si son nom normalisé était
identique au nom de l'ingrédient : « Carottes » correspondait à « carotte »,
« Carottes râpées bio 500g » jamais. Or les noms du stock sont des noms de
produits (ticket de caisse, code-barres, saisie libre), avec qualificatifs,
marque et contenance. Les recettes du catalogue n'étaient donc presque jamais
proposées pour un stock réel.

Règle ajoutée, prudente : un produit correspond à un ingrédient quand son nom
**commence** par le nom de l'ingrédient, mot pour mot, au singulier près :
« Carottes râpées bio 500g » → carotte ; « Lait demi-écrémé » → lait ;
« Tomates cerises » → tomate, tomate cerise.

Deux exceptions évitent les faux amis :
- un mot de liaison après le début forme un nom composé, qui désigne un autre
  produit : « pomme de terre » n'est pas une pomme, « beurre de cacahuète »
  n'est pas du beurre, « pâte à tartiner » n'est pas de la pâte ;
- quelques noms composés sans mot de liaison désignent aussi un autre produit
  (« crème dessert », « fromage blanc », « lait concentré »).

Les noms sont comparés mot à mot : « selle d'agneau » ne contient pas « sel ».
"""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Final

# Après le nom d'un aliment, ces mots forment un nom composé : « pomme de
# terre », « huile d'olive », « riz au lait », « pâte à tartiner ».
_LINKING_WORDS: Final = frozenset({"a", "au", "aux", "d", "de", "des", "du", "en", "l", "la", "le", "les"})

# Noms composés sans mot de liaison qui désignent un autre produit que leur
# premier mot. Clés au format normalisé (mots au singulier).
_DISTINCT_COMPOUNDS: Final = frozenset({
    "creme dessert",
    "fromage blanc",
    "fromage frai",
    "lait concentre",
})

_LIGATURES: Final = (("œ", "oe"), ("æ", "ae"), ("ß", "ss"))


def _singular(token: str) -> str:
    """Singulier approché : le pluriel français ajoute un « s » ou un « x »."""
    if len(token) > 3 and token[-1] in "sx":
        return token[:-1]
    return token


def normalized_tokens(name: str) -> list[str]:
    """Mots du nom, sans accents ni ponctuation, en minuscules, au singulier."""
    text = name.strip().lower()
    for ligature, replacement in _LIGATURES:
        text = text.replace(ligature, replacement)
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return [_singular(token) for token in text.split()]


@lru_cache(maxsize=4096)
def ingredient_key(name: str) -> str:
    """Clé d'un ingrédient de recette : « Carottes » → « carotte »."""
    return " ".join(normalized_tokens(name))


@lru_cache(maxsize=4096)
def stock_item_keys(name: str) -> frozenset[str]:
    """Ingrédients qu'un produit du stock peut fournir : chaque début de son
    nom, mot à mot, sauf ceux que suit un mot de liaison ou qui commencent un
    nom composé désignant un autre produit. Le nom complet en fait partie."""
    tokens = normalized_tokens(name)
    keys: set[str] = set()
    for end in range(1, len(tokens) + 1):
        prefix = tokens[:end]
        if prefix[-1] in _LINKING_WORDS:
            continue
        if end < len(tokens):
            if tokens[end] in _LINKING_WORDS:
                continue
            if " ".join(tokens[: end + 1]) in _DISTINCT_COMPOUNDS:
                continue
        keys.add(" ".join(prefix))
    return frozenset(keys)
