"""Comportement des étapes shell du workflow d'auto-merge, exécutées avec un
faux `gh` (`.github/workflows/auto-merge-pr.yml`).

- BUG-104 : seule l'exécution dont l'appel de fusion réussit écrit
  `merged=true`, qui déclenche le déploiement et les contrôles post-fusion.
  Deux exécutions concurrentes ne lancent donc pas deux déploiements, et une
  fusion refusée reste visible en rouge.
- BUG-105 : la désactivation de l'auto-merge fonctionne même quand la
  résolution de la PR a échoué avant d'écrire ses sorties.

Le branchement de ces étapes (conditions, permissions) est vérifié dans
tests/test_ci_non_regression_policy.py.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "auto-merge-pr.yml"
HEAD_SHA = "a" * 40

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="bash requis (présent sur les runners de la CI)")

# Faux `gh` : journalise ses arguments, répond selon FAKE_GH_MODE.
#   ok      : la fusion réussit ;
#   race    : la fusion est refusée car une autre exécution vient de fusionner ;
#   refused : la fusion est refusée (commit de tête changé), PR non fusionnée.
FAKE_GH = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
if [ "$1 $2 $3" = "api -X PUT" ]; then
  case "$FAKE_GH_MODE" in
    ok) echo true; exit 0 ;;
    race) echo '{"message":"Pull Request is not mergeable"}' >&2; exit 1 ;;
    *) echo '{"message":"Head branch was modified."}' >&2; exit 1 ;;
  esac
fi
if [ "$1" = "api" ]; then
  if [ "$FAKE_GH_MODE" = "race" ]; then echo true; else echo false; fi
  exit 0
fi
if [ "$1 $2" = "pr merge" ]; then
  echo "no auto-merge enabled" >&2
  exit 1
fi
exit 2
"""


def _step_script(name: str) -> str:
    """Script `run:` d'une étape, tel que le runner l'exécute."""
    workflow = WORKFLOW.read_text(encoding="utf-8")
    marker = f"      - name: {name}\n"
    assert workflow.count(marker) == 1, f"étape introuvable ou en double : {name}"
    block = workflow.split(marker)[1].split("        run: |\n", 1)[1]
    lines: list[str] = []
    for line in block.splitlines():
        if line.strip() and not line.startswith(" " * 10):
            break
        lines.append(line[10:])
    return "\n".join(lines).rstrip() + "\n"


def _run_step(name: str, tmp_path: Path, env: dict[str, str]) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    fake_gh = bin_dir / "gh"
    fake_gh.write_text(FAKE_GH, encoding="utf-8")
    fake_gh.chmod(0o755)
    script = tmp_path / "step.sh"
    script.write_text(_step_script(name), encoding="utf-8")
    log = tmp_path / "gh.log"
    log.touch()
    result = subprocess.run(
        # Le shell par défaut des étapes `run:` sur les runners Linux.
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        env={**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "FAKE_GH_LOG": str(log), **env},
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result, log.read_text(encoding="utf-8").splitlines()


@pytest.mark.parametrize(
    ("mode", "exit_code", "launches_post_merge"),
    [("ok", 0, True), ("race", 0, False), ("refused", 1, False)],
    ids=["fusion-reussie", "deja-fusionnee-par-une-autre-execution", "fusion-refusee"],
)
def test_bug_104_seule_l_execution_qui_fusionne_lance_la_suite(
    tmp_path: Path, mode: str, exit_code: int, launches_post_merge: bool
) -> None:
    output = tmp_path / "github_output"
    output.touch()

    result, gh_calls = _run_step(
        "Merge after strict critical checks gate",
        tmp_path,
        {"FAKE_GH_MODE": mode, "GITHUB_OUTPUT": str(output), "REPO": "o/r", "PR_NUMBER": "7", "HEAD_SHA": HEAD_SHA},
    )

    assert result.returncode == exit_code, result.stdout + result.stderr
    assert ("merged=true" in output.read_text(encoding="utf-8")) is launches_post_merge
    # La fusion est demandée pour le commit relu, en squash, une seule fois.
    assert gh_calls[0] == f"api -X PUT repos/o/r/pulls/7/merge -f merge_method=squash -f sha={HEAD_SHA} --jq .merged"
    assert sum("/merge " in call for call in gh_calls) == 1
    if mode == "race":
        assert "::warning::" in result.stdout
    if mode == "refused":
        assert "::error::" in result.stdout


@pytest.mark.parametrize(
    ("pr_number", "disarm_calls"),
    [("7", ["pr merge 7 --repo o/r --disable-auto"]), ("", [])],
    ids=["numero-connu", "aucun-numero"],
)
def test_bug_105_la_desactivation_fonctionne_sans_les_sorties_de_la_resolution(
    tmp_path: Path, pr_number: str, disarm_calls: list[str]
) -> None:
    result, gh_calls = _run_step(
        "Disarm auto-merge when a gate step failed",
        tmp_path,
        {"FAKE_GH_MODE": "ok", "REPO": "o/r", "PR_NUMBER": pr_number},
    )

    # Aucun auto-merge armé (le faux gh échoue) : l'étape reste verte.
    assert result.returncode == 0, result.stdout + result.stderr
    assert gh_calls == disarm_calls
