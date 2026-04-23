from pathlib import Path


def test_ci_runs_on_all_pushes_and_prs():
    workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "pull_request:" in workflow
    assert "push:" in workflow
    assert "branches:" not in workflow


def test_ci_jobs_do_not_ignore_failures():
    workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "continue-on-error: true" not in workflow


def test_ci_executes_backend_non_regression_test_suites():
    workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "tests/test_verify_tests_added_policy_script.py" in workflow
    assert "python -m pytest tests backend/tests --tb=short -q" in workflow


def test_ci_defines_fast_and_full_layers():
    workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "frontend-fast" in workflow
    assert "backend-fast" in workflow
    assert "frontend-full" in workflow
    assert "backend-full" in workflow
    assert "npm run test:ci" in workflow


def test_codex_autofix_requires_gemini_global_purpose_api_key_secret():
    workflow = Path(".github/workflows/codex-autofix.yml").read_text(encoding="utf-8")

    assert "if: ${{ secrets.GEMINI_GLOBAL_PURPOSE_API_KEY != '' }}" in workflow
