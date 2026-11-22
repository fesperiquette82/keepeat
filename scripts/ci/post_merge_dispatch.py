#!/usr/bin/env python3
"""Workflows lancés après une fusion faite par l'auto-merge (BUG-104).

Une fusion faite avec le jeton du workflow (`GITHUB_TOKEN`) ne déclenche aucun
workflow `push` : GitHub l'interdit pour éviter les boucles, seuls
`workflow_dispatch` et `repository_dispatch` font exception. Après la fusion
automatique de la PR #173, rien n'a donc tourné sur `main` : ni le déploiement
du back-end, ni les contrôles post-fusion, ni le build de l'APK. La production
est restée sur l'ancienne version jusqu'à un lancement à la main.

Le workflow d'auto-merge (`.github/workflows/auto-merge-pr.yml`) appelle ce
script juste après une fusion réussie. Il lance, par `workflow_dispatch` sur
`main`, ce qu'une fusion à la main aurait déclenché : chaque workflow `push`
sur `main` qui accepte un lancement manuel, avec le filtre de chemins de son
déclencheur `push` appliqué aux fichiers de la PR. Le déploiement n'est donc
lancé que si la PR touche le back-end.

Au moindre doute sur la liste des fichiers (erreur d'API, liste tronquée),
tout est lancé : un déploiement en trop redéploie le même code, un
déploiement manqué laisse la production en retard sur `main`.

Bibliothèque standard uniquement, comme le verrou de relecture : le workflow
l'exécute depuis `main`, sans rien installer.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from typing import Callable, Final, Sequence

# Même dossier : le workflow exécute ce script depuis scripts/ci.
from codex_fix_review_gate import parse_paginated

GhRunner = Callable[[Sequence[str]], str]
Sleeper = Callable[[float], None]

# Workflow lancé après la fusion → filtre `paths` de son déclencheur `push`
# sur main (None : aucun filtre, toute fusion le lance). Tenu aligné sur les
# fichiers des workflows par tests/test_post_merge_dispatch.py.
POST_MERGE_WORKFLOWS: Final[tuple[tuple[str, tuple[str, ...] | None], ...]] = (
    ("main-release-post-merge.yml", None),
    ("deploy-render-backend.yml", ("backend/**", ".github/workflows/deploy-render-backend.yml")),
    ("build-android-apk.yml", None),
)

# Workflows qu'une fusion sur main déclenche mais que ce script ne relance pas.
NOT_RELAUNCHED: Final[dict[str, str]] = {
    "ci.yml": "sans lancement manuel ; les contrôles post-fusion rejouent les suites complètes sur main",
    "admin-dashboard-monitoring.yml": (
        "sans lancement manuel ; la suite back-end complète des contrôles post-fusion inclut ces tests"
    ),
    "mobile-e2e.yml": (
        "suite exigée sur la PR avant la fusion (verrou des contrôles critiques), "
        "rejouée chaque nuit sur main par mobile-e2e-nightly.yml"
    ),
}

DISPATCH_ATTEMPTS: Final = 3


def path_matches(path: str, pattern: str) -> bool:
    """Filtre `paths` de GitHub, limité aux deux formes employées par les
    workflows relancés : `dossier/**` et un chemin exact. Toute autre forme
    est refusée plutôt que mal interprétée."""
    if pattern.startswith("!") or any(char in pattern.removesuffix("/**") for char in "*?[]"):
        raise ValueError(f"motif de chemins non pris en charge : {pattern}")
    if pattern.endswith("/**"):
        return path.startswith(pattern.removesuffix("**"))
    return path == pattern


def workflows_to_dispatch(changed_files: Sequence[str] | None) -> list[str]:
    """Workflows à lancer pour ces fichiers ; None (liste inconnue) : tous."""
    selected: list[str] = []
    for workflow, patterns in POST_MERGE_WORKFLOWS:
        if (
            patterns is None
            or changed_files is None
            or any(path_matches(path, pattern) for path in changed_files for pattern in patterns)
        ):
            selected.append(workflow)
    return selected


def fetch_changed_files(gh: GhRunner, *, repo: str, pr_number: int) -> list[str] | None:
    """Fichiers de la PR, ancien nom des fichiers déplacés compris. None si
    la liste est incomplète : l'API n'en rend que les 3 000 premiers."""
    pr = json.loads(gh(["api", f"repos/{repo}/pulls/{pr_number}"]))
    entries = parse_paginated(gh(["api", "--paginate", f"repos/{repo}/pulls/{pr_number}/files?per_page=100"]))
    if not isinstance(pr, dict) or len(entries) < int(pr.get("changed_files") or 0):
        return None
    paths: list[str] = []
    for entry in entries:
        paths.append(str(entry["filename"]))
        if entry.get("previous_filename"):
            paths.append(str(entry["previous_filename"]))
    return paths


def dispatch(gh: GhRunner, *, repo: str, workflow: str, ref: str, sleep: Sleeper) -> str | None:
    """Lance le workflow sur `ref`. Rend None en cas de succès, sinon l'erreur
    du dernier essai (une panne d'API passagère est réessayée)."""
    error = ""
    for attempt in range(1, DISPATCH_ATTEMPTS + 1):
        try:
            gh(["api", "-X", "POST", f"repos/{repo}/actions/workflows/{workflow}/dispatches", "-f", f"ref={ref}"])
            return None
        except Exception as exc:
            stderr = getattr(exc, "stderr", None)
            detail = stderr.strip() if isinstance(stderr, str) else ""
            error = detail or f"{type(exc).__name__}: {exc}"
            if attempt < DISPATCH_ATTEMPTS:
                sleep(10.0 * attempt)
    return error


def _gh_cli(args: Sequence[str]) -> str:
    completed = subprocess.run(["gh", *args], check=True, capture_output=True, text=True)
    return completed.stdout


def main(argv: Sequence[str] | None = None, *, gh: GhRunner = _gh_cli, sleep: Sleeper = time.sleep) -> int:
    parser = argparse.ArgumentParser(description="Lance les workflows post-fusion (BUG-104).")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--ref", default="main")
    args = parser.parse_args(argv)

    try:
        changed_files = fetch_changed_files(gh, repo=args.repo, pr_number=args.pr)
        if changed_files is None:
            print(f"::warning::Liste des fichiers de la PR #{args.pr} tronquée : tous les workflows post-fusion sont lancés.")
    except Exception as exc:
        print(
            f"::warning::Fichiers de la PR #{args.pr} illisibles ({type(exc).__name__}) : "
            "tous les workflows post-fusion sont lancés."
        )
        changed_files = None

    selected = workflows_to_dispatch(changed_files)
    failures = 0
    print(f"Workflows post-fusion de la PR #{args.pr} (sur {args.ref}) :")
    for workflow, _patterns in POST_MERGE_WORKFLOWS:
        if workflow not in selected:
            print(f"  - non lancé : {workflow} (la PR ne touche aucun fichier qui le concerne)")
            continue
        error = dispatch(gh, repo=args.repo, workflow=workflow, ref=args.ref, sleep=sleep)
        if error is None:
            print(f"  - lancé : {workflow}")
        else:
            failures += 1
            print(f"::error::{workflow} n'a pas pu être lancé après la fusion de la PR #{args.pr} : {error}")
    for workflow, reason in NOT_RELAUNCHED.items():
        print(f"  - jamais relancé ici : {workflow} ({reason})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
