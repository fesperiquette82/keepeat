"""BUG-104 : une fusion faite par l'auto-merge ne lançait ni le déploiement du
back-end, ni les contrôles post-fusion, ni le build de l'APK.

Une fusion faite avec le GITHUB_TOKEN ne déclenche aucun workflow `push` sur
`main`. Après la fusion automatique de la PR #173, la production est restée
sur l'ancienne version. Le workflow d'auto-merge lance donc lui-même, après sa
fusion, ce qu'une fusion à la main aurait déclenché
(`scripts/ci/post_merge_dispatch.py`). Ces tests couvrent le choix des
workflows, leur alignement sur les déclencheurs réels et les appels à l'API.
Le branchement dans le workflow est testé dans
tests/test_ci_non_regression_policy.py.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_CI = ROOT / "scripts" / "ci"
WORKFLOWS = ROOT / ".github" / "workflows"
if str(SCRIPTS_CI) not in sys.path:
    sys.path.append(str(SCRIPTS_CI))

_spec = importlib.util.spec_from_file_location("post_merge_dispatch", SCRIPTS_CI / "post_merge_dispatch.py")
assert _spec is not None and _spec.loader is not None
dispatch = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = dispatch
_spec.loader.exec_module(dispatch)

REPO = "owner/keepeat"
ALL = ["main-release-post-merge.yml", "deploy-render-backend.yml", "build-android-apk.yml"]
WITHOUT_DEPLOY = ["main-release-post-merge.yml", "build-android-apk.yml"]


class FakeGh:
    """`gh api` simulé : la PR, ses fichiers (en deux pages, comme
    `--paginate`) et les lancements de workflows."""

    def __init__(
        self,
        files: list[dict[str, Any]],
        *,
        changed_files: int | None = None,
        files_error: bool = False,
        failures: dict[str, int] | None = None,
    ) -> None:
        self.files = files
        self.changed_files = len(files) if changed_files is None else changed_files
        self.files_error = files_error
        self.failures = dict(failures or {})
        self.calls: list[list[str]] = []

    def __call__(self, args: Sequence[str]) -> str:
        call = list(args)
        self.calls.append(call)
        path = _api_path(call)
        if path.endswith("/dispatches"):
            workflow = path.split("/")[-2]
            if self.failures.get(workflow, 0) > 0:
                self.failures[workflow] -= 1
                raise subprocess.CalledProcessError(1, ["gh", *call], stderr="HTTP 500: Server Error\n")
            return ""
        if self.files_error:
            raise subprocess.CalledProcessError(1, ["gh", *call], stderr="HTTP 502: Bad Gateway\n")
        if "/files" in path:
            half = len(self.files) // 2
            return json.dumps(self.files[:half]) + "\n" + json.dumps(self.files[half:])
        return json.dumps({"number": 42, "state": "closed", "merged": True, "changed_files": self.changed_files})

    def dispatched(self) -> list[str]:
        return [_api_path(call).split("/")[-2] for call in self.calls if _api_path(call).endswith("/dispatches")]


def _api_path(call: Sequence[str]) -> str:
    return next(arg for arg in call if arg.startswith("repos/"))


def _files(*names: str) -> list[dict[str, Any]]:
    return [{"filename": name, "status": "modified"} for name in names]


def _run(gh: FakeGh, capsys: pytest.CaptureFixture[str]) -> tuple[int, str, list[float]]:
    sleeps: list[float] = []
    code = dispatch.main(["--repo", REPO, "--pr", "42"], gh=gh, sleep=sleeps.append)
    return code, capsys.readouterr().out, sleeps


# --- Choix des workflows : ceux qu'une fusion à la main aurait déclenchés ------


def test_bug_104_une_pr_qui_touche_le_back_end_est_deployee_apres_la_fusion(
    capsys: pytest.CaptureFixture[str],
) -> None:
    gh = FakeGh(_files("backend/server.py", "frontend/app/index.tsx"))

    code, out, _ = _run(gh, capsys)

    assert code == 0
    assert gh.dispatched() == ALL
    for call in gh.calls:
        if _api_path(call).endswith("/dispatches"):
            assert call == ["api", "-X", "POST", _api_path(call), "-f", "ref=main"]
            assert _api_path(call).startswith(f"repos/{REPO}/actions/workflows/")
    assert "lancé : deploy-render-backend.yml" in out


def test_une_pr_sans_back_end_lance_les_controles_et_l_apk_mais_ne_deploie_pas(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # « docs/backend/… » et « backend-notes.md » ne sont pas sous backend/.
    gh = FakeGh(_files("frontend/app/index.tsx", "docs/backend/notes.md", "backend-notes.md"))

    code, out, _ = _run(gh, capsys)

    assert code == 0
    assert gh.dispatched() == WITHOUT_DEPLOY
    assert "non lancé : deploy-render-backend.yml" in out


@pytest.mark.parametrize(
    "files",
    [
        _files(".github/workflows/deploy-render-backend.yml"),
        [{"filename": "backend/legacy_service.py", "status": "removed"}],
        [{"filename": "docs/old_service.py", "previous_filename": "backend/old_service.py", "status": "renamed"}],
    ],
    ids=["workflow-de-deploiement", "fichier-supprime", "fichier-sorti-du-back-end"],
)
def test_toute_modification_du_back_end_ou_de_son_deploiement_redeploie(
    files: list[dict[str, Any]], capsys: pytest.CaptureFixture[str]
) -> None:
    gh = FakeGh(files)

    code, _, _ = _run(gh, capsys)

    assert code == 0
    assert gh.dispatched() == ALL


def test_une_liste_de_fichiers_tronquee_lance_tout(capsys: pytest.CaptureFixture[str]) -> None:
    # L'API ne rend que les 3 000 premiers fichiers d'une PR.
    gh = FakeGh(_files("frontend/app/index.tsx"), changed_files=3001)

    code, out, _ = _run(gh, capsys)

    assert code == 0
    assert gh.dispatched() == ALL
    assert "::warning::" in out


def test_des_fichiers_illisibles_lancent_tout(capsys: pytest.CaptureFixture[str]) -> None:
    gh = FakeGh(_files("frontend/app/index.tsx"), files_error=True)

    code, out, _ = _run(gh, capsys)

    assert code == 0
    assert gh.dispatched() == ALL
    assert "::warning::" in out


# --- Lancements : pannes passagères et échecs visibles -------------------------


def test_une_panne_passagere_de_l_api_est_reessayee(capsys: pytest.CaptureFixture[str]) -> None:
    gh = FakeGh(_files("backend/server.py"), failures={"deploy-render-backend.yml": 2})

    code, out, sleeps = _run(gh, capsys)

    assert code == 0
    assert gh.dispatched().count("deploy-render-backend.yml") == 3
    assert sleeps == [10.0, 20.0]
    assert "lancé : deploy-render-backend.yml" in out


def test_un_lancement_impossible_echoue_en_rouge_sans_bloquer_les_autres(
    capsys: pytest.CaptureFixture[str],
) -> None:
    gh = FakeGh(_files("backend/server.py"), failures={"main-release-post-merge.yml": 99})

    code, out, _ = _run(gh, capsys)

    assert code == 1
    assert gh.dispatched().count("main-release-post-merge.yml") == dispatch.DISPATCH_ATTEMPTS
    assert "deploy-render-backend.yml" in gh.dispatched()
    assert "build-android-apk.yml" in gh.dispatched()
    assert "::error::main-release-post-merge.yml" in out
    assert "HTTP 500" in out


@pytest.mark.parametrize("pattern", ["scripts/e2e-*", "backend/*.py", "!backend/docs/**", "app.config.*"])
def test_un_motif_de_chemins_non_pris_en_charge_est_refuse(pattern: str) -> None:
    with pytest.raises(ValueError):
        dispatch.path_matches("backend/server.py", pattern)


# --- Alignement sur les déclencheurs réels des workflows -----------------------


def _on_block(text: str) -> str:
    match = re.search(r"^on:[ \t]*\n((?:(?:[ \t]+[^\n]*|[ \t]*|#[^\n]*)\n)*)", text, flags=re.MULTILINE)
    assert match is not None, "bloc on: introuvable"
    return match.group(1)


def _sub_block(block: str, key: str, indent: int) -> str | None:
    pad = " " * indent
    match = re.search(
        rf"^{pad}{re.escape(key)}:[^\n]*\n((?:(?:{pad}[ \t]+[^\n]*|[ \t]*)\n)*)", block, flags=re.MULTILINE
    )
    return None if match is None else match.group(1)


def _items(block: str) -> list[str]:
    return [line.strip()[2:].strip().strip("'\"") for line in block.splitlines() if line.strip().startswith("- ")]


def _runs_on_push_to_main(push: str) -> bool:
    branches = _sub_block(push, "branches", 4)
    if branches is not None:
        return "main" in _items(branches)
    ignored = _sub_block(push, "branches-ignore", 4)
    if ignored is not None:
        return "main" not in _items(ignored)
    # Un filtre de tags seul exclut les pushs de branche.
    return _sub_block(push, "tags", 4) is None and _sub_block(push, "tags-ignore", 4) is None


def test_chaque_workflow_declenche_par_une_fusion_sur_main_est_relance_ou_ecarte_avec_sa_raison() -> None:
    push_on_main: set[str] = set()
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        push = _sub_block(_on_block(path.read_text(encoding="utf-8")), "push", 2)
        if push is not None and _runs_on_push_to_main(push):
            push_on_main.add(path.name)

    relaunched = {workflow for workflow, _ in dispatch.POST_MERGE_WORKFLOWS}
    not_relaunched = set(dispatch.NOT_RELAUNCHED)
    assert "deploy-render-backend.yml" in relaunched
    assert push_on_main == relaunched | not_relaunched, "nouveau workflow sur main : le relancer ou dire pourquoi"
    assert not relaunched & not_relaunched
    assert all(reason.strip() for reason in dispatch.NOT_RELAUNCHED.values())


@pytest.mark.parametrize(("workflow", "patterns"), dispatch.POST_MERGE_WORKFLOWS)
def test_un_workflow_relance_accepte_le_lancement_manuel_avec_le_filtre_de_son_declencheur_push(
    workflow: str, patterns: tuple[str, ...] | None
) -> None:
    on = _on_block((WORKFLOWS / workflow).read_text(encoding="utf-8"))

    manual = _sub_block(on, "workflow_dispatch", 2)
    assert manual is not None, "sans workflow_dispatch, l'API refuse le lancement"
    assert "required: true" not in manual, "le script ne transmet aucune entrée"

    push = _sub_block(on, "push", 2)
    assert push is not None and _runs_on_push_to_main(push)
    assert _sub_block(push, "paths-ignore", 4) is None
    paths = _sub_block(push, "paths", 4)
    assert (None if paths is None else tuple(_items(paths))) == patterns
    for pattern in patterns or ():
        dispatch.path_matches("backend/server.py", pattern)  # motif pris en charge


def test_le_script_tourne_sans_rien_installer() -> None:
    source = (SCRIPTS_CI / "post_merge_dispatch.py").read_text(encoding="utf-8")
    imported: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.add((node.module or "").split(".")[0])
    assert imported <= {"__future__", "argparse", "codex_fix_review_gate", "json", "subprocess", "sys", "time", "typing"}
