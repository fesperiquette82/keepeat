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


def test_maestro_e2e_is_fully_runnable_in_github_actions():
    workflow = Path(".github/workflows/mobile-e2e.yml").read_text(encoding="utf-8")

    assert "services:" in workflow
    assert "mongodb:" in workflow
    assert "mongo:7" in workflow
    assert "MONGO_URL: mongodb://127.0.0.1:27017/keepeat_e2e_test" in workflow
    assert "DB_NAME: keepeat_e2e_test" in workflow
    assert "APP_ENV: test" in workflow
    assert "EXPO_PUBLIC_BACKEND_URL: http://10.0.2.2:8000" in workflow
    assert "curl --fail http://127.0.0.1:8000/health" in workflow
    assert "POST http://127.0.0.1:8000/api/test/reset" in workflow
    assert "POST http://127.0.0.1:8000/api/test/seed" in workflow
    assert "scripts/e2e-reset-seed.mjs" in workflow
    assert "reactivecircus/android-emulator-runner@v2" in workflow
    assert "maestro test \"$flow_file\"" in workflow
    assert "frontend/android/app/build/outputs/apk/debug/app-debug.apk" in workflow
    assert "actions/upload-artifact@v4" in workflow
    assert "DISABLE_EXTERNAL_SERVICES: \"true\"" in workflow
