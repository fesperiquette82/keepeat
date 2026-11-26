#!/usr/bin/env python3
"""Éléments visibles d'un écran Android, à partir d'un `uiautomator dump`.

Appelé par scripts/run-maestro-e2e.sh quand un scénario Maestro échoue
(BUG-107) : une ligne par élément qui porte un identifiant (testID), un texte
ou une description, pour lire dans le journal de la CI ce que l'app affichait.
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET


def describe(xml_text: str) -> list[str]:
    lines = []
    for node in ET.fromstring(xml_text).iter("node"):
        resource_id = node.get("resource-id", "")
        text = node.get("text", "")
        description = node.get("content-desc", "")
        if resource_id or text or description:
            lines.append(f"  {node.get('bounds', '')} | {resource_id} | {text} | {description}")
    return lines


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: e2e-ui-dump.py <ui.xml>", file=sys.stderr)
        return 2
    try:
        with open(argv[1], encoding="utf-8") as handle:
            lines = describe(handle.read())
    except (OSError, ET.ParseError) as exc:
        print(f"  (unreadable UI dump: {exc})")
        return 0
    print("\n".join(lines) if lines else "  (no element with an id, text or description)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
