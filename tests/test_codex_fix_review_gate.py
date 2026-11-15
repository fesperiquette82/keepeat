"""BUG-097 : un correctif de Codex ne fusionne pas sans relecture du commit exact.

Tests de comportement du verrou exécuté par `.github/workflows/auto-merge-pr.yml`
(`scripts/ci/codex_fix_review_gate.py`). Les cas reprennent la forme réelle des
PR de Codex dans ce dépôt : ouvertes et signées sous le compte du propriétaire,
étiquette `codex`, branche `codex/…`.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Sequence

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "ci" / "codex_fix_review_gate.py"
_spec = importlib.util.spec_from_file_location("codex_fix_review_gate", SCRIPT_PATH)
assert _spec is not None and _spec.loader is not None
gate = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = gate
_spec.loader.exec_module(gate)

OWNER = "fesperiquette82"
HEAD = "a" * 40
OLD_HEAD = "b" * 40
OWNER_ACCOUNT = {"login": OWNER, "type": "User"}
CLAUDE_ACCOUNT = {"login": "claude", "type": "User"}
WEB_FLOW = {"login": "web-flow", "type": "User"}
CODEX_BOT = {"login": "chatgpt-codex-connector[bot]", "type": "Bot"}
ACTIONS_BOT = {"login": "github-actions[bot]", "type": "Bot"}


def _pr(**overrides: Any) -> dict[str, Any]:
    pr: dict[str, Any] = {
        "number": 200,
        "body": "Corrige un bug d'affichage.",
        "user": OWNER_ACCOUNT,
        "labels": [],
        "head": {"sha": HEAD, "ref": "claude/keepeat-project"},
        "commits": 1,
        "auto_merge": None,
    }
    pr.update(overrides)
    return pr


def _commit(sha: str = HEAD, author: Any = CLAUDE_ACCOUNT, committer: Any = CLAUDE_ACCOUNT) -> dict[str, Any]:
    return {"sha": sha, "author": author, "committer": committer}


def _comment(body: str, user: Any = OWNER_ACCOUNT, **extra: Any) -> dict[str, Any]:
    return {"body": body, "user": user, **extra}


def _marker(sha: str = HEAD, verdict: str = "approved") -> str:
    return f"Relecture du correctif.\n\n<!-- codex-fix-review: sha={sha} verdict={verdict} -->"


def _evaluate(**overrides: Any) -> dict[str, Any]:
    inputs: dict[str, Any] = {
        "pr": _pr(),
        "issue_comments": [],
        "review_comments": [],
        "reviews": [],
        "commits": [_commit()],
        "issue_events": [],
    }
    inputs.update(overrides)
    return gate.evaluate(**inputs, owner=OWNER)


def _codex_pr(**overrides: Any) -> dict[str, Any]:
    """Une PR de Codex telle qu'on les voit dans le dépôt (#116 à #136)."""
    return _pr(labels=[{"name": "codex"}], head={"sha": HEAD, "ref": "codex/fix-ci-logic"}, **overrides)


def _codex_commit() -> dict[str, Any]:
    return _commit(author=OWNER_ACCOUNT, committer=OWNER_ACCOUNT)


# --- Quelles PR exigent une relecture -------------------------------------


def test_pr_du_proprietaire_sans_trace_de_codex_ne_demande_aucune_relecture():
    decision = _evaluate()
    assert decision["needs_review"] is False
    assert decision["reasons"] == []
    assert decision["review_ok"] is True


def test_pr_de_codex_est_reconnue_alors_que_tout_est_signe_par_le_proprietaire():
    decision = _evaluate(pr=_codex_pr(), commits=[_codex_commit()])
    assert decision["needs_review"] is True
    assert decision["review_ok"] is False


@pytest.mark.parametrize("label", ["codex", "codex-autofix", "Codex-Autofix"])
def test_etiquette_codex_seule_suffit(label: str):
    decision = _evaluate(pr=_pr(labels=[{"name": label}]))
    assert decision["needs_review"] is True
    assert decision["review_ok"] is False


def test_etiquette_retiree_apres_coup_ne_leve_pas_la_relecture():
    events = [
        {"event": "labeled", "label": {"name": "codex-autofix"}},
        {"event": "unlabeled", "label": {"name": "codex-autofix"}},
    ]
    decision = _evaluate(issue_events=events)
    assert decision["needs_review"] is True
    assert any("retirée" in reason for reason in decision["reasons"])


def test_etiquette_sans_rapport_ne_demande_rien():
    events = [{"event": "labeled", "label": {"name": "bug"}}, {"event": "closed"}]
    decision = _evaluate(pr=_pr(labels=[{"name": "bug"}]), issue_events=events)
    assert decision["needs_review"] is False


def test_branche_codex_sans_etiquette_est_reconnue():
    # Cas de la PR #138 : branche codex/…, aucune étiquette.
    decision = _evaluate(pr=_pr(head={"sha": HEAD, "ref": "codex/fix-ci-logic-for-maestro-checks"}))
    assert decision["needs_review"] is True


@pytest.mark.parametrize(
    "where",
    ["pr_body", "issue_comment", "review_comment", "review"],
)
def test_demande_adressee_a_codex_sur_une_pr_de_claude(where: str):
    request = "@codex corrige le test en échec"
    overrides: dict[str, Any] = {}
    if where == "pr_body":
        overrides["pr"] = _pr(body=f"## Label auto-fix\n- raison : autoriser la boucle CI à commenter {request}")
    elif where == "issue_comment":
        # Le commentaire que publie la boucle d'auto-correction.
        overrides["issue_comments"] = [_comment(f"{request}\n<!-- codex-autodebug: sha=x -->", user=ACTIONS_BOT)]
    elif where == "review_comment":
        overrides["review_comments"] = [_comment(request)]
    else:
        overrides["reviews"] = [_comment(request)]
    decision = _evaluate(**overrides)
    assert decision["needs_review"] is True
    assert decision["review_ok"] is False


@pytest.mark.parametrize(
    "text",
    [
        "La boucle publie un commentaire `@codex` quand un check échoue.",
        "Écrire à contact@codex.dev pour le support.",
        "Voir le dossier .github/codex/prompts et la branche codex/x.",
        "Ce correctif vient de Codex.",
    ],
)
def test_parler_de_codex_n_est_pas_lui_adresser_une_demande(text: str):
    decision = _evaluate(pr=_pr(body=text), issue_comments=[_comment(text)])
    assert decision["needs_review"] is False


def test_pr_ouverte_par_un_robot_demande_une_relecture():
    decision = _evaluate(pr=_pr(user=CODEX_BOT))
    assert decision["needs_review"] is True


@pytest.mark.parametrize(
    "commit",
    [
        _commit(author=CODEX_BOT, committer=CODEX_BOT),
        _commit(author={"login": "bhanuprasad14", "type": "User"}),
        _commit(author=None, committer=None),
        _commit(committer={"login": "inconnu", "type": "User"}),
    ],
)
def test_commit_hors_des_comptes_de_confiance_demande_une_relecture(commit: dict[str, Any]):
    decision = _evaluate(commits=[commit])
    assert decision["needs_review"] is True
    assert any("commit hors des comptes de confiance" in reason for reason in decision["reasons"])


def test_commits_du_proprietaire_de_claude_et_de_l_interface_github_sont_de_confiance():
    commits = [
        _commit(sha="1" * 40, author=OWNER_ACCOUNT, committer=WEB_FLOW),
        _commit(sha="2" * 40, author=OWNER_ACCOUNT, committer=OWNER_ACCOUNT),
        _commit(),
    ]
    decision = _evaluate(pr=_pr(commits=3), commits=commits)
    assert decision["needs_review"] is False


def test_liste_de_commits_tronquee_vaut_relecture():
    decision = _evaluate(pr=_pr(commits=300), commits=[_commit()])
    assert decision["needs_review"] is True
    assert any("incomplète" in reason for reason in decision["reasons"])


# --- Ce qui vaut approbation ----------------------------------------------


def test_approbation_du_proprietaire_pour_le_commit_de_tete_ouvre_la_fusion():
    decision = _evaluate(pr=_codex_pr(), commits=[_codex_commit()], issue_comments=[_comment(_marker())])
    assert decision["needs_review"] is True
    assert decision["verdict"] == "approved"
    assert decision["review_ok"] is True


def test_nouveau_commit_invalide_l_approbation_precedente():
    decision = _evaluate(
        pr=_codex_pr(),
        commits=[_codex_commit()],
        issue_comments=[_comment(_marker(sha=OLD_HEAD))],
    )
    assert decision["verdict"] is None
    assert decision["review_ok"] is False


@pytest.mark.parametrize("author", [CODEX_BOT, ACTIONS_BOT, {"login": "quelquun", "type": "User"}])
def test_approbation_ecrite_par_un_autre_compte_ne_compte_pas(author: dict[str, Any]):
    decision = _evaluate(
        pr=_codex_pr(),
        commits=[_codex_commit()],
        issue_comments=[_comment(_marker(), user=author)],
    )
    assert decision["review_ok"] is False


def test_codex_ne_s_approuve_pas_sous_le_compte_du_proprietaire():
    comment = _comment(_marker(), performed_via_github_app={"slug": "chatgpt-codex-connector", "name": "ChatGPT Codex Connector"})
    decision = _evaluate(pr=_codex_pr(), commits=[_codex_commit()], issue_comments=[comment])
    assert decision["review_ok"] is False


def test_approbation_postee_par_une_session_claude_sous_le_compte_du_proprietaire_compte():
    comment = _comment(_marker(), performed_via_github_app={"slug": "claude", "name": "Claude"})
    decision = _evaluate(pr=_codex_pr(), commits=[_codex_commit()], issue_comments=[comment])
    assert decision["review_ok"] is True


def test_le_dernier_verdict_l_emporte():
    approved = _comment(_marker())
    rejected = _comment(_marker(verdict="changes-requested"))
    revoked = _evaluate(pr=_codex_pr(), commits=[_codex_commit()], issue_comments=[approved, rejected])
    assert revoked["verdict"] == "changes-requested"
    assert revoked["review_ok"] is False
    restored = _evaluate(pr=_codex_pr(), commits=[_codex_commit()], issue_comments=[rejected, approved])
    assert restored["review_ok"] is True


@pytest.mark.parametrize(
    "body",
    [
        f"<!-- codex-fix-review: sha={HEAD[:7]} verdict=approved -->",
        f"<!-- codex-fix-review: sha={HEAD} verdict=ok -->",
        f"codex-fix-review: sha={HEAD} verdict=approved",
        "Relu, tout est bon.",
    ],
)
def test_marqueur_approximatif_ne_vaut_pas_approbation(body: str):
    decision = _evaluate(pr=_codex_pr(), commits=[_codex_commit()], issue_comments=[_comment(body)])
    assert decision["review_ok"] is False


def test_approbation_dans_une_revue_de_code_ne_compte_pas_seul_le_commentaire_de_pr_compte():
    decision = _evaluate(pr=_codex_pr(), commits=[_codex_commit()], reviews=[_comment(_marker())])
    assert decision["review_ok"] is False


def test_pr_sans_commit_de_tete_connu_est_refusee():
    decision = _evaluate(pr=_pr(head={}))
    assert decision["review_ok"] is False


# --- Exécution : appels GitHub, refus par défaut, désarmement -------------


class FakeGh:
    def __init__(self, responses: dict[str, Any], *, fail_on: str | None = None) -> None:
        self.responses = responses
        self.fail_on = fail_on
        self.calls: list[list[str]] = []

    def __call__(self, args: Sequence[str]) -> str:
        self.calls.append(list(args))
        joined = " ".join(args)
        if self.fail_on and self.fail_on in joined:
            raise RuntimeError("HTTP 502")
        if args[:2] == ["pr", "merge"]:
            return ""
        path = args[-1].split("?")[0]
        payload = self.responses[path]
        if "--paginate" in args:
            # gh écrit une liste JSON par page, bout à bout.
            half = len(payload) // 2
            return json.dumps(payload[:half]) + json.dumps(payload[half:])
        return json.dumps(payload)

    @property
    def disarm_calls(self) -> list[list[str]]:
        return [call for call in self.calls if "--disable-auto" in call]


def _responses(pr: dict[str, Any], *, comments: Sequence[dict[str, Any]] = (), commits: Sequence[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "repos/o/r/pulls/200": pr,
        "repos/o/r/issues/200/comments": list(comments),
        "repos/o/r/pulls/200/comments": [],
        "repos/o/r/pulls/200/reviews": [],
        "repos/o/r/pulls/200/commits": list(commits) if commits is not None else [_commit()],
        "repos/o/r/issues/200/events": [],
    }


def _run(gh: FakeGh) -> dict[str, Any]:
    return gate.run_gate(gh, repo="o/r", pr_number=200, owner=OWNER)


def test_pr_de_codex_non_relue_desarme_l_auto_merge_deja_arme():
    pr = _codex_pr(auto_merge={"merge_method": "squash"})
    gh = FakeGh(_responses(pr, commits=[_codex_commit()]))
    decision = _run(gh)
    assert decision["review_ok"] is False
    assert gh.disarm_calls == [["pr", "merge", "200", "--repo", "o/r", "--disable-auto"]]
    assert decision["auto_merge_disabled"] is True
    assert decision["error"] is None


def test_pr_de_codex_non_relue_sans_auto_merge_arme_ne_tente_rien():
    gh = FakeGh(_responses(_codex_pr(), commits=[_codex_commit()]))
    decision = _run(gh)
    assert decision["review_ok"] is False
    assert gh.disarm_calls == []
    assert decision["error"] is None


def test_pr_de_codex_relue_laisse_l_auto_merge_en_place():
    pr = _codex_pr(auto_merge={"merge_method": "squash"})
    gh = FakeGh(_responses(pr, comments=[_comment(_marker())], commits=[_codex_commit()]))
    decision = _run(gh)
    assert decision["review_ok"] is True
    assert gh.disarm_calls == []


def test_les_reponses_paginees_sont_lues_en_entier():
    # L'approbation est sur la seconde page de commentaires.
    comments = [_comment("merci"), _comment("ok"), _comment("suite"), _comment(_marker())]
    gh = FakeGh(_responses(_codex_pr(), comments=comments, commits=[_codex_commit()]))
    assert _run(gh)["review_ok"] is True


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("[]", []),
        ('[{"a": 1}, {"a": 2}]', [{"a": 1}, {"a": 2}]),
        ('[{"a": 1}][{"a": 2}]', [{"a": 1}, {"a": 2}]),
        ('[{"a": 1}]\n[]\n[{"a": 2}]\n', [{"a": 1}, {"a": 2}]),
    ],
)
def test_lecture_des_pages_selon_la_version_de_gh(raw: str, expected: list[Any]):
    # Selon sa version, gh fusionne les pages en une liste ou les écrit bout à bout.
    assert gate.parse_paginated(raw) == expected


def test_reponse_paginee_qui_n_est_pas_une_liste_est_rejetee():
    with pytest.raises(ValueError):
        gate.parse_paginated('{"message": "Not Found"}')


def test_panne_de_l_api_vaut_refus_et_desarmement():
    gh = FakeGh(_responses(_pr()), fail_on="issues/200/comments")
    decision = _run(gh)
    assert decision["review_ok"] is False
    assert "vérification impossible" in decision["error"]
    assert len(gh.disarm_calls) == 1


def test_reponse_inattendue_de_l_api_vaut_refus():
    responses = _responses(_pr())
    responses["repos/o/r/pulls/200"] = ["pas", "un", "objet"]
    decision = _run(FakeGh(responses))
    assert decision["review_ok"] is False
    assert decision["error"] is not None


def test_desarmement_impossible_est_signale_comme_une_erreur():
    pr = _codex_pr(auto_merge={"merge_method": "squash"})
    gh = FakeGh(_responses(pr, commits=[_codex_commit()]), fail_on="--disable-auto")
    decision = _run(gh)
    assert decision["review_ok"] is False
    assert decision["auto_merge_disabled"] is False
    assert "désarmement" in decision["error"]


def _main(gh: FakeGh, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[int, dict[str, str]]:
    output = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    code = gate.main(["--repo", "o/r", "--pr", "200", "--owner", OWNER], gh=gh)
    lines = output.read_text(encoding="utf-8").splitlines()
    return code, dict(line.split("=", 1) for line in lines)


def test_sortie_du_workflow_pour_une_pr_de_codex_non_relue(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    code, outputs = _main(FakeGh(_responses(_codex_pr(), commits=[_codex_commit()])), tmp_path, monkeypatch)
    assert code == 0
    assert outputs == {"review_ok": "false", "reviewed_head_sha": HEAD}
    printed = capsys.readouterr().out
    assert "fusion automatique refusée" in printed
    assert f"<!-- codex-fix-review: sha={HEAD} verdict=approved -->" in printed


def test_sortie_du_workflow_pour_une_pr_relue(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    gh = FakeGh(_responses(_codex_pr(), comments=[_comment(_marker())], commits=[_codex_commit()]))
    code, outputs = _main(gh, tmp_path, monkeypatch)
    assert code == 0
    assert outputs == {"review_ok": "true", "reviewed_head_sha": HEAD}


def test_sortie_du_workflow_quand_la_verification_est_impossible(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    code, outputs = _main(FakeGh(_responses(_pr()), fail_on="pulls/200/commits"), tmp_path, monkeypatch)
    assert code == 1, "une vérification impossible doit apparaître en rouge"
    assert outputs == {"review_ok": "false", "reviewed_head_sha": ""}
    assert "::error::" in capsys.readouterr().out
