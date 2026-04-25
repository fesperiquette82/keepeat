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
    assert 'maestro test "$flow_file"' in workflow
    assert "frontend/android/app/build/outputs/apk/debug/app-debug.apk" in workflow
    assert "actions/upload-artifact@v4" in workflow
    assert 'DISABLE_EXTERNAL_SERVICES: "true"' in workflow


def test_codex_auto_fix_workflow_has_required_guardrails():
    workflow = Path(".github/workflows/codex-auto-fix.yml").read_text(encoding="utf-8")

    assert "workflow_run:" in workflow
    assert "types:" in workflow
    assert "completed" in workflow
    assert "- CI" in workflow
    assert "- Mobile E2E (Maestro)" in workflow
    assert "- Admin dashboard monitoring tests" in workflow
    assert "conclusion == 'failure'" in workflow
    assert "event == 'pull_request'" in workflow
    assert "head_ref" in workflow
    assert "head.repo.full_name" in workflow
    assert 'OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}' in workflow
    assert "fromJSON(steps.attempts.outputs.next_attempt) > 3" in workflow
    assert "<!-- codex-autofix-attempt:" in workflow
    assert "openai/codex-action@v1" in workflow
    assert "prompt-file: .github/codex/prompts/auto-fix-ci.md" in workflow
    assert "sandbox: workspace-write" in workflow
    assert "safety-strategy: drop-sudo" in workflow
    assert "python -m pytest tests/test_ci_non_regression_policy.py -q" in workflow
    assert "python -m py_compile backend/server.py backend/test_mode.py" in workflow
    assert 'git push origin "${{ steps.pr.outputs.head_ref }}"' in workflow
    assert "gh pr comment" in workflow
    assert "pull_request_target" not in workflow


def test_codex_auto_fix_prompt_exists_and_forbids_weakening_tests():
    prompt = Path(".github/codex/prompts/auto-fix-ci.md").read_text(encoding="utf-8")

    assert "Ne jamais désactiver un test" in prompt
    assert "Ne jamais supprimer ni affaiblir une assertion de non-régression" in prompt
    assert "Ne jamais affaiblir les scénarios Maestro métier" in prompt
    assert "Ne jamais contourner test-policy" in prompt
    assert "Ne jamais désactiver les garde-fous anti-appels externes" in prompt
