#!/usr/bin/env python3
"""Verrou de relecture avant fusion automatique (BUG-097).

L'auto-merge (`.github/workflows/auto-merge-pr.yml`) fusionne toute PR verte
vers `main`. Depuis que la suite Maestro est réparée, un correctif poussé par
Codex pouvait donc arriver sur `main` sans qu'aucun regard ne se pose dessus :
les règles « ne pas affaiblir un test » ne sont que des consignes données à
Codex, rien ne les fait respecter.

Ce script décide si une PR peut être confiée à l'auto-merge :

- une PR « touchée par Codex » exige une relecture du commit de tête exact ;
- la relecture est un commentaire de PR écrit par le compte du propriétaire du
  dépôt (lui-même, ou une session Claude à qui il a demandé de suivre la PR),
  portant le marqueur `<!-- codex-fix-review: sha=<40 hex> verdict=approved -->` ;
- tout nouveau commit change le SHA de tête : l'approbation précédente ne vaut
  plus ;
- au moindre doute (erreur d'API, liste de commits tronquée, marqueur absent),
  la réponse est non et l'auto-merge déjà armé est désarmé.

Codex ouvre ses PR et signe ses commits sous le compte du propriétaire : son
identité ne le distingue pas. « Touchée par Codex » se déduit donc de faits
observés sur ses PR dans ce dépôt : l'étiquette `codex` (posée par son
intégration GitHub) ou `codex-autofix` (qui active la boucle d'auto-correction),
même retirée depuis ; une branche `codex/…` ; une demande adressée à Codex sur
la PR. S'y ajoutent deux filets : une PR ouverte par un autre compte que le
propriétaire, un commit dont le compte n'est pas dans la liste de confiance.

Bibliothèque standard uniquement : le workflow l'exécute depuis `main`, sans
rien installer. C'est un garde-fou de processus, pas une barrière contre un
acteur malveillant : un outil qui détient le jeton du propriétaire peut écrire
le marqueur à sa place.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any, Callable, Iterable, Sequence

CODEX_LABELS = frozenset({"codex", "codex-autofix"})
CODEX_BRANCH_PREFIX = "codex/"
REVIEW_MARKER_RE = re.compile(
    r"<!--\s*codex-fix-review:\s*sha=([0-9a-f]{40})\s+verdict=(approved|changes-requested)\s*-->"
)
# Une mention active : ni adresse e-mail (`contact@codex.dev`), ni code cité.
CODEX_REQUEST_RE = re.compile(r"(?<![\w`/.\-])@codex\b", re.IGNORECASE)
# Un verdict écrit par l'intégration GitHub de l'outil relu ne compte pas, même
# sous le compte du propriétaire : Codex ne s'approuve pas lui-même.
REVIEWED_TOOL_APP_HINTS = ("codex", "chatgpt", "openai")
# Comptes dont les commits ne déclenchent pas la relecture, en plus du
# propriétaire : les sessions Claude (`claude`) et les commits créés par
# l'interface GitHub (`web-flow`).
DEFAULT_TRUSTED_LOGINS = ("claude", "web-flow")

GhRunner = Callable[[Sequence[str]], str]


def _text_field(item: Any, key: str) -> str:
    if isinstance(item, dict):
        value = item.get(key)
        if isinstance(value, str):
            return value
    return ""


def _login(account: Any) -> str:
    return _text_field(account, "login").lower()


def _is_bot(account: Any) -> bool:
    return isinstance(account, dict) and account.get("type") == "Bot"


def _body(item: Any) -> str:
    return _text_field(item, "body")


def _label_name(label: Any) -> str:
    return _text_field(label, "name").lower()


def review_reasons(
    *,
    pr: dict[str, Any],
    texts: Iterable[str],
    commits: Sequence[dict[str, Any]],
    issue_events: Sequence[dict[str, Any]],
    owner: str,
    trusted_logins: Iterable[str],
) -> list[str]:
    """Raisons pour lesquelles la PR exige une relecture. Liste vide : aucune."""
    owner_login = owner.lower()
    trusted = {owner_login, *(login.lower() for login in trusted_logins)}
    reasons: list[str] = []

    current_labels = {_label_name(label) for label in pr.get("labels") or []}
    past_labels = {
        _label_name(event.get("label"))
        for event in issue_events
        if isinstance(event, dict) and event.get("event") == "labeled"
    }
    for label in sorted(CODEX_LABELS & current_labels):
        reasons.append(f"étiquette {label}")
    for label in sorted((CODEX_LABELS & past_labels) - current_labels):
        reasons.append(f"étiquette {label} posée puis retirée")

    head_ref = str((pr.get("head") or {}).get("ref") or "")
    if head_ref.lower().startswith(CODEX_BRANCH_PREFIX):
        reasons.append(f"branche {head_ref} créée par Codex")

    if any(CODEX_REQUEST_RE.search(text) for text in texts):
        reasons.append("une demande a été adressée à Codex sur cette PR")

    author = pr.get("user")
    if _is_bot(author) or _login(author) != owner_login:
        reasons.append(f"PR ouverte par « {_login(author) or 'inconnu'} », pas par le propriétaire")

    expected = pr.get("commits")
    if not isinstance(expected, int) or expected != len(commits):
        reasons.append(f"liste des commits incomplète ({len(commits)} lus sur {expected})")

    untrusted: list[str] = []
    for commit in commits:
        for role in ("author", "committer"):
            account = commit.get(role)
            login = _login(account)
            if _is_bot(account) or login not in trusted:
                untrusted.append(f"{str(commit.get('sha', '?'))[:7]} ({role} : {login or 'compte inconnu'})")
                break
    if untrusted:
        reasons.append("commit hors des comptes de confiance : " + ", ".join(untrusted[:5]))

    return reasons


def _written_by_reviewed_tool(comment: dict[str, Any]) -> bool:
    app = comment.get("performed_via_github_app")
    if not isinstance(app, dict):
        return False
    identity = f"{app.get('slug') or ''} {app.get('name') or ''}".lower()
    return any(hint in identity for hint in REVIEWED_TOOL_APP_HINTS)


def review_verdict(issue_comments: Sequence[dict[str, Any]], *, owner: str, head_sha: str) -> str | None:
    """Verdict de la dernière relecture du commit de tête écrite par le
    propriétaire, ou None. Un marqueur pour un autre commit, écrit par un autre
    compte ou par l'intégration de Codex, ne compte pas."""
    owner_login = owner.lower()
    verdict: str | None = None
    for comment in issue_comments:
        author = comment.get("user")
        if _login(author) != owner_login or _is_bot(author) or _written_by_reviewed_tool(comment):
            continue
        for sha, value in REVIEW_MARKER_RE.findall(_body(comment)):
            if sha == head_sha:
                verdict = value
    return verdict


def evaluate(
    *,
    pr: dict[str, Any],
    issue_comments: Sequence[dict[str, Any]],
    review_comments: Sequence[dict[str, Any]],
    reviews: Sequence[dict[str, Any]],
    commits: Sequence[dict[str, Any]],
    issue_events: Sequence[dict[str, Any]],
    owner: str,
    trusted_logins: Iterable[str] = DEFAULT_TRUSTED_LOGINS,
) -> dict[str, Any]:
    head_sha = str((pr.get("head") or {}).get("sha") or "")
    texts = [_body(pr), *map(_body, issue_comments), *map(_body, review_comments), *map(_body, reviews)]
    reasons = review_reasons(
        pr=pr,
        texts=texts,
        commits=commits,
        issue_events=issue_events,
        owner=owner,
        trusted_logins=trusted_logins,
    )
    needs_review = bool(reasons)
    verdict = review_verdict(issue_comments, owner=owner, head_sha=head_sha) if head_sha else None
    return {
        "head_sha": head_sha,
        "needs_review": needs_review,
        "reasons": reasons,
        "verdict": verdict,
        "review_ok": bool(head_sha) and (not needs_review or verdict == "approved"),
        "auto_merge_armed": pr.get("auto_merge") is not None,
        "error": None,
    }


def parse_paginated(text: str) -> list[Any]:
    """`gh api --paginate` écrit une liste JSON par page, bout à bout."""
    decoder = json.JSONDecoder()
    items: list[Any] = []
    position = 0
    while position < len(text):
        if text[position].isspace():
            position += 1
            continue
        page, position = decoder.raw_decode(text, position)
        if not isinstance(page, list):
            raise ValueError("réponse paginée inattendue : une liste était attendue")
        items.extend(page)
    return items


def fetch_inputs(gh: GhRunner, *, repo: str, pr_number: int) -> dict[str, Any]:
    def pages(path: str) -> list[Any]:
        return parse_paginated(gh(["api", "--paginate", f"repos/{repo}/{path}?per_page=100"]))

    pr = json.loads(gh(["api", f"repos/{repo}/pulls/{pr_number}"]))
    if not isinstance(pr, dict):
        raise ValueError("réponse inattendue pour la PR")
    return {
        "pr": pr,
        "issue_comments": pages(f"issues/{pr_number}/comments"),
        "review_comments": pages(f"pulls/{pr_number}/comments"),
        "reviews": pages(f"pulls/{pr_number}/reviews"),
        "commits": pages(f"pulls/{pr_number}/commits"),
        "issue_events": pages(f"issues/{pr_number}/events"),
    }


def run_gate(
    gh: GhRunner,
    *,
    repo: str,
    pr_number: int,
    owner: str,
    trusted_logins: Iterable[str] = DEFAULT_TRUSTED_LOGINS,
) -> dict[str, Any]:
    """Évalue la PR et désarme l'auto-merge si la relecture manque. Toute
    erreur vaut un refus : on ne fusionne pas ce qu'on n'a pas pu vérifier."""
    try:
        inputs = fetch_inputs(gh, repo=repo, pr_number=pr_number)
        decision = evaluate(**inputs, owner=owner, trusted_logins=trusted_logins)
    except Exception as exc:  # refus par défaut, quelle que soit la panne
        decision = {
            "head_sha": "",
            "needs_review": True,
            "reasons": [],
            "verdict": None,
            "review_ok": False,
            # État inconnu : on tente le désarmement dans le doute.
            "auto_merge_armed": True,
            "error": f"vérification impossible : {type(exc).__name__}: {exc}",
        }

    decision["auto_merge_disabled"] = False
    if not decision["review_ok"] and decision["auto_merge_armed"]:
        try:
            gh(["pr", "merge", str(pr_number), "--repo", repo, "--disable-auto"])
            decision["auto_merge_disabled"] = True
        except Exception as exc:
            if decision["error"] is None:
                # L'auto-merge était armé et il le reste : à signaler en rouge.
                decision["error"] = f"désarmement de l'auto-merge impossible : {type(exc).__name__}: {exc}"
    return decision


def _gh_cli(args: Sequence[str]) -> str:
    completed = subprocess.run(["gh", *args], check=True, capture_output=True, text=True)
    return completed.stdout


def main(argv: Sequence[str] | None = None, *, gh: GhRunner = _gh_cli) -> int:
    parser = argparse.ArgumentParser(description="Verrou de relecture avant fusion automatique.")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--trusted-logins", default=",".join(DEFAULT_TRUSTED_LOGINS))
    args = parser.parse_args(argv)

    trusted = [login.strip() for login in args.trusted_logins.split(",") if login.strip()]
    decision = run_gate(gh, repo=args.repo, pr_number=args.pr, owner=args.owner, trusted_logins=trusted)

    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as handle:
            handle.write(f"review_ok={'true' if decision['review_ok'] else 'false'}\n")
            handle.write(f"reviewed_head_sha={decision['head_sha']}\n")

    short_sha = decision["head_sha"][:7] or "cette PR"
    if decision["review_ok"] and not decision["needs_review"]:
        print(f"Verrou de relecture : aucune relecture requise pour {short_sha}.")
    elif decision["review_ok"]:
        print(f"Verrou de relecture : {short_sha} relu et approuvé.")
    else:
        print(f"Verrou de relecture : fusion automatique refusée pour {short_sha}.")
    for reason in decision["reasons"]:
        print(f"  - relecture requise : {reason}")
    if decision["needs_review"] and not decision["review_ok"] and decision["error"] is None:
        state = "modifications demandées" if decision["verdict"] else "aucun verdict"
        print(f"  Relecture de ce commit : {state}.")
        print("  Attendu : un commentaire du propriétaire portant")
        print(f"  <!-- codex-fix-review: sha={decision['head_sha']} verdict=approved -->")
    if decision["auto_merge_disabled"]:
        print("  L'auto-merge déjà armé a été désarmé.")
    if decision["error"] is not None:
        print(f"::error::{decision['error']}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
