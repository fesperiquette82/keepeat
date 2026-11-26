"""BUG-107 : en cas d'échec d'un scénario Maestro, le lanceur écrit dans le
journal de la CI les éléments affichés à l'écran (`scripts/e2e-ui-dump.py`),
car les captures ne sont lisibles qu'en téléchargeant les artefacts."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "e2e-ui-dump.py"
_spec = importlib.util.spec_from_file_location("e2e_ui_dump", SCRIPT)
assert _spec is not None and _spec.loader is not None
ui_dump = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = ui_dump
_spec.loader.exec_module(ui_dump)

DUMP = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="Passez à Premium" resource-id="premium-title" content-desc="" bounds="[48,200][1032,280]" />
    <node index="1" text="" resource-id="" content-desc="" bounds="[0,300][1080,400]" />
    <node index="2" text="" resource-id="premium-close" content-desc="Fermer" bounds="[960,80][1040,160]" />
  </node>
</hierarchy>
"""


def test_les_elements_identifies_ou_textuels_sont_listes_les_autres_ignores() -> None:
    assert ui_dump.describe(DUMP) == [
        "  [48,200][1032,280] | premium-title | Passez à Premium | ",
        "  [960,80][1040,160] | premium-close |  | Fermer",
    ]


def test_un_fichier_illisible_n_interrompt_pas_le_lanceur(tmp_path: Path, capsys) -> None:
    broken = tmp_path / "ui.xml"
    broken.write_text("<hierarchy><node", encoding="utf-8")

    assert ui_dump.main(["e2e-ui-dump.py", str(broken)]) == 0
    assert "unreadable UI dump" in capsys.readouterr().out
    assert ui_dump.main(["e2e-ui-dump.py", str(tmp_path / "absent.xml")]) == 0
