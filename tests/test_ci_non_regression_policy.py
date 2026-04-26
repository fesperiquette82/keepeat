import re
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
    assert "backend/tests/test_recipe_suggestions_contract.py" in workflow


def test_ci_defines_pr_check_layers():
    workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "frontend-pr-checks" in workflow
    assert "backend-pr-checks" in workflow
    assert "policy-pr-checks" in workflow
    assert "Frontend regression tests" in workflow
    assert "Backend regression tests" in workflow
    assert "Non-regression policy checks" in workflow
    assert "npm run test:ci" in workflow
    assert "python -m pytest" in workflow


def test_main_release_post_merge_workflow_keeps_full_suites():
    workflow = Path(".github/workflows/main-release-post-merge.yml").read_text(encoding="utf-8")

    assert "push:" in workflow
    assert "branches:" in workflow
    assert "- main" in workflow
    assert "tags:" in workflow
    assert "workflow_dispatch:" in workflow
    assert "frontend-main-release-full" in workflow
    assert "backend-main-release-full" in workflow
    assert "npm run test:full" in workflow
    assert "npm run build" in workflow
    assert "python -m pytest tests backend/tests --tb=short -q" in workflow


def test_maestro_e2e_is_fully_runnable_in_github_actions():
    workflow = Path(".github/workflows/mobile-e2e.yml").read_text(encoding="utf-8")
    maestro_script = Path("scripts/run-maestro-e2e.sh").read_text(encoding="utf-8")
    build_job_block = workflow.split("maestro-e2e:")[0]
    filters_block = workflow.split("filters: |")[1].split("Decide whether APK build / Maestro are required")[0]

    assert "Mobile E2E / Changes detection gate" in workflow
    assert "mobile_apk_required" in workflow
    assert "maestro_required" in workflow
    assert "reason=" in workflow
    assert "force_mobile_apk_build" in workflow
    assert "workflow_dispatch_force_mobile_apk_build" in workflow
    assert "dorny/paths-filter@v3" in workflow
    assert "mobile_apk_required:" in workflow
    assert "maestro_required:" in workflow
    assert "'frontend/**'" in workflow
    assert "'.maestro/**'" in workflow
    assert "'.github/workflows/mobile-e2e.yml'" in workflow
    assert "'scripts/e2e-*'" in workflow
    assert "'scripts/run-maestro-e2e.sh'" in workflow
    assert "'android/**'" in filters_block
    assert "'app.json'" in filters_block
    assert "'app.config.*'" in filters_block
    assert "'eas.json'" in filters_block
    assert "'assets/**'" in filters_block
    assert "'frontend/**'" in filters_block
    assert "'package.json'" in filters_block
    assert "'package-lock.json'" in filters_block
    assert "'backend/**'" not in filters_block
    assert "'docs/**'" not in filters_block

    apk_filter_block = filters_block.split("mobile_apk_required:")[1].split("maestro_required:")[0]
    assert "'.maestro/**'" not in apk_filter_block
    assert "'scripts/run-maestro-e2e.sh'" not in apk_filter_block

    maestro_filter_block = filters_block.split("maestro_required:")[1]
    assert "'.maestro/**'" in maestro_filter_block
    assert "'scripts/run-maestro-e2e.sh'" in maestro_filter_block

    assert "build-android-debug-apk:" in workflow
    assert "maestro-e2e:" in workflow
    assert "needs:" in workflow
    assert "- build-android-debug-apk" in workflow
    assert workflow.index("Try reusing existing PR APK artifact") < workflow.index("Build debug APK")
    assert "needs.changes.outputs.maestro_required == 'true'" in workflow
    assert "Try reusing existing PR APK artifact" in workflow
    assert 'gh api "repos/$REPO/actions/runs?event=pull_request&status=success&per_page=100"' in workflow
    assert "current_head_sha=" in workflow
    assert "artifact_source_head_sha=" in workflow
    assert "source_head_sha_equals_current=" in workflow
    assert "apk_relevant_files_changed_since_source=" in workflow
    assert "if [ \"$RUN_HEAD_SHA\" = \"$CURRENT_HEAD_SHA\" ];" in workflow
    assert "git diff --name-only \"$RUN_HEAD_SHA\" \"$CURRENT_HEAD_SHA\"" in workflow
    assert "Cannot verify diff: source SHA $RUN_HEAD_SHA is unavailable locally." in workflow
    assert "Skip run_id=$RUN_ID: cannot prove APK compatibility." in workflow
    assert "frontend/**" in workflow
    assert "android/**" in workflow
    assert "assets/**" in workflow
    assert "app.json" in workflow
    assert "app.config.*" in workflow
    assert "eas.json" in workflow
    assert "package.json" in workflow
    assert "package-lock.json" in workflow
    assert "babel.config.*" in workflow
    assert "metro.config.*" in workflow
    assert "tsconfig*.json" in workflow
    assert "scripts/run-maestro-e2e.sh" not in workflow.split("git diff --name-only")[1].split("if [ -n \"$CHANGED_APK_FILES\" ]")[0]
    assert ".github/workflows/mobile-e2e.yml" not in workflow.split("git diff --name-only")[1].split("if [ -n \"$CHANGED_APK_FILES\" ]")[0]
    assert "pull_requests[]?" in workflow
    assert 'gh run download "$RUN_ID" --name android-debug-apk --dir e2e-apk' in workflow
    assert "Build Android debug APK\" and .conclusion == \"success" in workflow
    assert "Downloaded artifact is invalid: missing e2e-apk/app-debug.apk" in workflow
    assert "needs.changes.outputs.maestro_required == 'true' && needs.build-android-debug-apk.outputs.apk_ready == 'true'" in workflow
    assert "Mobile E2E / Not required (changes filter)" in workflow
    assert "needs.changes.outputs.maestro_required == 'false' || needs.build-android-debug-apk.outputs.apk_ready != 'true'" in workflow
    assert "No valid reusable APK was found for this PR/head SHA and rebuild was not required." in workflow
    assert "force_mobile_apk_build=true" in workflow
    assert "Mobile E2E / Build Android debug APK" in workflow
    assert "if: needs.changes.outputs.mobile_apk_required == 'true'" in workflow
    assert "Mobile E2E / PR smoke Maestro suite" in workflow
    assert "name: android-debug-apk" in workflow
    assert "uses: actions/download-artifact@v4" in workflow
    assert "Download Android debug APK artifact (built in current run)" in workflow
    assert "Download reusable Android debug APK artifact (source run)" in workflow
    assert "name: android-debug-apk" in workflow
    assert "Fail if APK artifact is missing" in workflow
    assert "e2e-apk/app-debug.apk" in workflow
    assert "if: steps.apk_decision.outputs.apk_source == 'built'" in workflow
    assert 'maestro test "$flow_file"' not in build_job_block
    assert "services:" in workflow
    assert "mongodb:" in workflow
    assert "mongo:7" in workflow
    assert "MONGO_URL: mongodb://127.0.0.1:27017/keepeat_e2e_test" in workflow
    assert "DB_NAME: keepeat_e2e_test" in workflow
    assert "APP_ENV: test" in workflow
    assert 'DISABLE_EXTERNAL_SERVICES: "true"' in workflow
    assert "JWT_SECRET: test-secret" in workflow
    assert "PYTHONPATH: ${{ github.workspace }}" in workflow
    assert "pip install -r backend/requirements.txt" in workflow
    assert "Waiting for MongoDB test service..." in workflow
    assert "from pymongo import MongoClient" in workflow
    assert "import backend.server" in workflow
    assert "python -m uvicorn backend.server:app" in workflow
    assert "if [ \"$HEALTH_OK\" != \"true\" ]; then" in workflow
    assert "cat backend-e2e.log" in workflow
    assert "kill -0 \"$UVICORN_PID\"" in workflow
    assert "Python import diagnostics:" in workflow
    assert "importlib.import_module('backend.server')" in workflow
    assert "EXPO_PUBLIC_BACKEND_URL: http://10.0.2.2:8000" in workflow
    assert "E2E_RESET_SEED_BASE_URL: http://127.0.0.1:8000" in workflow
    assert "curl --fail \"$E2E_RESET_SEED_BASE_URL/health\"" in workflow
    assert "curl --silent --fail http://127.0.0.1:8000/health" in workflow
    assert "POST http://127.0.0.1:8000/api/test/reset" in workflow
    assert "POST http://127.0.0.1:8000/api/test/seed" in workflow
    assert "try_reuse_apk=" in workflow
    assert "reuse_apk_success=" in workflow
    assert "build_apk_step_should_run=" in workflow
    assert "scripts/e2e-reset-seed.mjs" in maestro_script
    assert "reactivecircus/android-emulator-runner@v2" in workflow
    assert "shell: bash" not in workflow
    assert 'MAESTRO_SUITE: smoke' in workflow
    assert 'MAESTRO_DRIVER_STARTUP_TIMEOUT: "180000"' in workflow
    assert "bash scripts/run-maestro-e2e.sh --suite \"$MAESTRO_SUITE\"" in workflow
    assert 'MAESTRO_SUITE="full"' in maestro_script
    assert 'MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}"' in maestro_script
    assert 'echo "MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT}"' in maestro_script
    assert "export MAESTRO_DRIVER_STARTUP_TIMEOUT" in maestro_script
    timeout_match = re.search(r'MAESTRO_DRIVER_STARTUP_TIMEOUT: "(\d+)"', workflow)
    assert timeout_match, "MAESTRO_DRIVER_STARTUP_TIMEOUT must be set in workflow"
    assert int(timeout_match.group(1)) >= 120000
    assert '--suite' in maestro_script
    assert 'if [ "$MAESTRO_SUITE" != "smoke" ] && [ "$MAESTRO_SUITE" != "full" ]; then' in maestro_script
    assert 'FLOW_FILES=()' in maestro_script
    assert 'if [ "$MAESTRO_SUITE" = "smoke" ]; then' in maestro_script
    assert '".maestro/00-smoke-launch.yaml"' in maestro_script
    assert '".maestro/01-auth-session.yaml"' in maestro_script
    assert '".maestro/02-navigation-main-tabs.yaml"' in maestro_script
    assert 'for flow_file in "${FLOW_FILES[@]}"; do' in maestro_script
    assert "adb wait-for-device" in maestro_script
    assert "adb devices -l" in maestro_script
    assert "sys.boot_completed" in maestro_script
    assert "pm list packages \"$E2E_ANDROID_APP_ID\"" in maestro_script
    assert "sleep 8" in maestro_script
    assert "pm clear" not in maestro_script
    assert 'mode="seeded"' in maestro_script
    assert 'if [ "$flow_name" = "03-stock-empty-state" ]; then' in maestro_script
    assert 'adb shell am force-stop "$E2E_ANDROID_APP_ID" || true' in maestro_script
    assert "adb shell am force-stop dev.mobile.maestro || true" in maestro_script
    assert "sleep 2" in maestro_script
    assert "==> Running flow: $flow_name (mode=$mode)" in maestro_script
    assert "E2E_RESET_SEED_BASE_URL" in maestro_script
    assert 'node scripts/e2e-reset-seed.mjs --mode "$mode" --base-url "$E2E_RESET_SEED_BASE_URL"' in maestro_script
    assert "10.0.2.2:8000" not in maestro_script
    assert "find .maestro -maxdepth 1 -name '*.yaml' ! -name 'config.yaml' | sort" in maestro_script
    assert '~/.maestro/bin/maestro test "$flow_file"' in maestro_script
    assert "❌ Maestro flow failed: $flow_name" in maestro_script
    assert "find maestro-results -maxdepth 3 -type f | sort || true" in maestro_script
    assert "tail -n 200 backend-e2e.log || true" in maestro_script
    assert "actions/upload-artifact@v4" in workflow
    assert "adb install -r e2e-apk/app-debug.apk" in maestro_script


def test_smoke_flows_use_seeded_e2e_account_and_are_independent():
    auth_flow = Path(".maestro/01-auth-session.yaml").read_text(encoding="utf-8")
    tabs_flow = Path(".maestro/02-navigation-main-tabs.yaml").read_text(encoding="utf-8")
    runner_script = Path("scripts/run-maestro-e2e.sh").read_text(encoding="utf-8")

    assert 'id: login-email-input' in auth_flow
    assert 'runFlow:' in auth_flow
    assert 'when:' in auth_flow
    assert 'notVisible:' in auth_flow
    assert "when:\n      visible:\n        id: tab-home" in auth_flow
    assert 'id: tab-home' in auth_flow
    assert "assertVisible:\n    id: login-email-input" not in auth_flow
    assert "extendedWaitUntil:\n    visible:\n      id: tab-home" in auth_flow
    assert 'inputText: e2e.free@keepeat.test' in auth_flow
    assert 'inputText: TestPassword123!' in auth_flow

    assert 'id: login-email-input' in tabs_flow
    assert 'runFlow:' in tabs_flow
    assert 'inputText: e2e.free@keepeat.test' in tabs_flow
    assert 'inputText: TestPassword123!' in tabs_flow
    assert 'id: tab-home' in tabs_flow
    assert 'id: tab-stock' in tabs_flow
    assert 'id: tab-recipes' in tabs_flow

    assert '".maestro/00-smoke-launch.yaml"' in runner_script
    assert '".maestro/01-auth-session.yaml"' in runner_script
    assert '".maestro/02-navigation-main-tabs.yaml"' in runner_script


def test_mobile_e2e_nightly_runs_full_suite():
    workflow = Path(".github/workflows/mobile-e2e-nightly.yml").read_text(encoding="utf-8")

    assert "name: Mobile E2E Nightly (Maestro full)" in workflow
    assert "schedule:" in workflow
    assert "cron: '30 2 * * *'" in workflow
    assert "workflow_dispatch:" in workflow
    assert "build-android-debug-apk:" in workflow
    assert "maestro-e2e-full:" in workflow
    assert "Mobile E2E nightly / Full Maestro suite" in workflow
    assert "MONGO_URL: mongodb://127.0.0.1:27017/keepeat_e2e_test" in workflow
    assert 'MAESTRO_SUITE: full' in workflow
    assert 'bash scripts/run-maestro-e2e.sh --suite "$MAESTRO_SUITE"' in workflow


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
    assert "label" in workflow
    assert "codex" in workflow
    assert "auto-fix" in workflow
    assert "WATCHED_CHECKS_JSON" in workflow
    assert "Non-regression policy checks" in workflow
    assert "Mobile E2E / PR smoke Maestro suite" in workflow
    assert "Mobile E2E / Build Android debug APK" in workflow
    assert "Backend admin dashboard tests" in workflow
    assert "Vercel" in workflow
    assert "ALLOWED_BASE_REGEX" in workflow
    assert "head.repo.full_name" in workflow
    assert "<!-- codex-autodebug: sha=" in workflow
    assert "MAX_ATTEMPTS_PER_SHA" in workflow
    assert "auto-fix skipped: no PR" in workflow
    assert "auto-fix skipped: missing label" in workflow
    assert "auto-fix skipped: fork PR" in workflow
    assert "auto-fix skipped: bot actor" in workflow
    assert "auto-fix skipped: run marked as autofix commit" in workflow
    assert "auto-fix skipped: already attempted for this SHA" in workflow
    assert "auto-fix triggered: comment posted" in workflow
    assert "gh run view" in workflow
    assert "gh run download" in workflow
    assert "maestro-results" in workflow or "codex-auto-debug" in workflow
    assert "@codex" in workflow
    assert "gh pr comment" in workflow
    assert "actions: read" in workflow
    assert "checks: read" in workflow
    assert "contents: read" in workflow
    assert "pull-requests: write" in workflow
    assert "openai/codex-action@v1" not in workflow
    assert "./gradlew" not in workflow
    assert "npx expo prebuild" not in workflow
    assert 'maestro test "' not in workflow
    assert "android-emulator-runner" not in workflow
    assert "pull_request_target" not in workflow


def test_codex_autofix_is_isolated_from_auto_merge_and_release_workflows():
    codex_workflow = Path(".github/workflows/codex-auto-fix.yml").read_text(encoding="utf-8")
    auto_merge_workflow = Path(".github/workflows/auto-merge-pr.yml").read_text(encoding="utf-8")
    release_workflow = Path(".github/workflows/main-release-post-merge.yml").read_text(encoding="utf-8")

    assert "codex-autodebug" in codex_workflow
    assert "codex-autodebug" not in auto_merge_workflow
    assert "codex-autodebug" not in release_workflow
    assert "@codex" not in auto_merge_workflow
    assert "@codex" not in release_workflow


def test_auto_merge_workflow_requires_explicit_critical_success_checks():
    workflow = Path(".github/workflows/auto-merge-pr.yml").read_text(encoding="utf-8")

    assert "name: Enable auto-merge on PRs to main" in workflow
    assert "pull_request_target:" in workflow
    assert "check_suite:" in workflow
    assert "workflow_run:" in workflow
    assert "workflows:" in workflow
    assert "- CI" in workflow
    assert "- Admin dashboard monitoring tests" in workflow
    assert "- Mobile E2E (Maestro)" in workflow
    assert "should_run=false" in workflow
    assert "Skip: untrusted fork PR" in workflow
    assert "REQUIRED_CHECKS_JSON" in workflow
    assert "Frontend regression tests" in workflow
    assert "Backend regression tests" in workflow
    assert "Non-regression policy checks" in workflow
    assert "Backend admin dashboard tests" in workflow
    assert "Mobile E2E / Changes detection gate" in workflow
    assert "MOBILE_NOT_REQUIRED_CHECK" in workflow
    assert "Mobile E2E / Not required (changes filter)" in workflow
    assert "Mobile E2E / Build Android debug APK" in workflow
    assert "Mobile E2E / PR smoke Maestro suite" in workflow
    assert "either explicit \"not required\" success OR both build+maestro success" in workflow
    assert "if [ \"$STATUS\" = \"completed\" ] && [ \"$CONCLUSION\" = \"success\" ];" in workflow
    assert "Critical checks gate failed" in workflow
    assert "mergeStateStatus" not in workflow
    assert "Ready to merge" not in workflow
    assert "--auto --squash" in workflow
    assert "git push origin" not in workflow


def test_codex_auto_fix_prompt_exists_and_forbids_weakening_tests():
    prompt = Path(".github/codex/prompts/auto-fix-ci.md").read_text(encoding="utf-8")

    assert "Ne jamais désactiver un test" in prompt
    assert "Ne jamais supprimer ni affaiblir une assertion de non-régression" in prompt
    assert "Ne jamais affaiblir les scénarios Maestro métier" in prompt
    assert "Ne jamais contourner test-policy" in prompt
    assert "Ne jamais désactiver les garde-fous anti-appels externes" in prompt


def test_codex_auto_fix_docs_describe_labels_watchlist_and_limits():
    docs = Path("docs/codex-auto-fix.md").read_text(encoding="utf-8")

    assert "codex" in docs
    assert "auto-fix" in docs
    assert "WATCHED_CHECKS_JSON" in docs
    assert "Non-regression policy checks" in docs
    assert "Mobile E2E / PR smoke Maestro suite" in docs
    assert "Mobile E2E / Build Android debug APK" in docs
    assert "Backend admin dashboard tests" in docs
    assert "Vercel" in docs
    assert "MAX_ATTEMPTS_PER_SHA" in docs
    assert "github-actions[bot]" in docs
    assert "codex auto-fix" in docs
    assert "ne build pas l’APK" in docs
    assert "ne lance pas Maestro" in docs
    assert "ne fait jamais d’auto-merge" in docs


def test_admin_dashboard_workflow_runs_pytest_with_package_pythonpath():
    workflow = Path(".github/workflows/admin-dashboard-monitoring.yml").read_text(encoding="utf-8")

    assert "PYTHONPATH: ${{ github.workspace }}" in workflow
    assert "python -m pytest -q backend/tests/test_admin_monitoring.py backend/tests/test_admin_monitoring_dashboard_api.py" in workflow
