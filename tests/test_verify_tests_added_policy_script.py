from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "verify-tests-added.mjs"


def _run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


def _git_init_with_baseline(repo_dir: Path) -> None:
    _run(["git", "init"], cwd=repo_dir)
    _run(["git", "config", "user.name", "ci-test"], cwd=repo_dir)
    _run(["git", "config", "user.email", "ci-test@example.com"], cwd=repo_dir)
    (repo_dir / "backend").mkdir(parents=True)
    (repo_dir / "tests").mkdir(parents=True)
    (repo_dir / "backend" / "app.py").write_text("def compute():\n    return 1\n", encoding="utf-8")
    (repo_dir / "tests" / "test_placeholder.py").write_text("def test_placeholder():\n    assert True\n", encoding="utf-8")
    _run(["git", "add", "."], cwd=repo_dir)
    _run(["git", "commit", "-m", "baseline"], cwd=repo_dir)


def test_policy_accepts_root_tests_directory_for_backend_code_changes(tmp_path: Path):
    _git_init_with_baseline(tmp_path)
    (tmp_path / "backend" / "app.py").write_text("def compute():\n    return 2\n", encoding="utf-8")
    (tmp_path / "tests" / "test_regression.py").write_text(
        "def test_regression():\n    assert 2 == 2\n",
        encoding="utf-8",
    )
    _run(["git", "add", "."], cwd=tmp_path)
    _run(["git", "commit", "-m", "code + tests"], cwd=tmp_path)

    result = subprocess.run(
        ["node", str(SCRIPT_PATH), "HEAD~1"],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "Policy check passed" in result.stdout


def test_policy_still_fails_when_backend_code_changes_without_tests(tmp_path: Path):
    _git_init_with_baseline(tmp_path)
    (tmp_path / "backend" / "app.py").write_text("def compute():\n    return 3\n", encoding="utf-8")
    _run(["git", "add", "."], cwd=tmp_path)
    _run(["git", "commit", "-m", "code only"], cwd=tmp_path)

    result = subprocess.run(
        ["node", str(SCRIPT_PATH), "HEAD~1"],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "Policy violation" in result.stderr
