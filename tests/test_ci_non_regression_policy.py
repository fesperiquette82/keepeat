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
    assert 'gh api "repos/$REPO/actions/runs?event=pull_request&per_page=100"' in workflow
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
    assert "Mobile E2E / Not required or missing required APK" in workflow
    assert "needs.changes.outputs.maestro_required == 'false' || needs.build-android-debug-apk.outputs.apk_ready != 'true'" in workflow
    assert "Fail when Maestro is required but no compatible APK is available" in workflow
    assert "Maestro is required but no compatible APK artifact was found. Re-run with workflow_dispatch force_mobile_apk_build=true or provide a compatible APK artifact." in workflow
    assert "Upload Mobile E2E gate diagnostics" in workflow
    assert "name: mobile-e2e-gate-diagnostics" in workflow
    assert "ci-diagnostics/mobile-e2e-gate.txt" in workflow
    assert "Explain skip reason when Maestro is not required" in workflow
    assert "Mobile E2E skipped: Maestro is not required for this change set." in workflow
    assert "force_mobile_apk_build=true" in workflow
    assert "force_mobile_apk_build=true" in workflow
    assert "Mobile E2E / Build Android debug APK" in workflow
    assert "if: steps.decide_build.outputs.build_apk_step_should_run == 'true'" in workflow
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
    assert "Decide whether to build APK" in workflow
    assert "build_apk_step_should_run=" in workflow.split("Decide whether to build APK")[1].split("Setup Node")[0]
    assert "Maestro required but no reusable APK found" in workflow
    assert "steps.decide_build.outputs.build_apk_step_should_run == 'true'" in workflow
    assert workflow.count("steps.decide_build.outputs.build_apk_step_should_run == 'true'") >= 5, "Setup Node, Install deps, Setup Java, Prebuild, Build APK should all use decide_build condition"
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
    assert "assertNotVisible:\n          id: login-email-input" in auth_flow
    assert "extendedWaitUntil:\n    visible:\n      id: tab-home" in auth_flow
    assert "takeScreenshot: 01-auth-session-login-still-visible-after-submit" in auth_flow
    assert "takeScreenshot: 01-auth-session-login-still-visible-after-retry" in auth_flow
    assert 'inputText: e2e.free@keepeat.test' in auth_flow
    assert 'inputText: TestPassword123!' in auth_flow
    assert "hideKeyboard" in auth_flow

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
    assert "workflow_dispatch:" in workflow
    assert "run_id:" in workflow
    assert "types:" in workflow
    assert "completed" in workflow
    assert "- CI" in workflow
    assert "- Mobile E2E (Maestro)" in workflow
    assert "- Admin dashboard monitoring tests" in workflow
    assert "conclusion == 'failure'" in workflow
    assert "event == 'pull_request'" in workflow
    assert "label" in workflow
    assert "codex-autofix" in workflow
    assert "HAS_CODEX_AUTOFIX_LABEL" in workflow
    assert '[.labels[].name] | index("codex-autofix") != null' in workflow
    assert "WATCHED_CHECKS_JSON" in workflow
    assert "Non-regression policy checks" in workflow
    assert "Mobile E2E / PR smoke Maestro suite" in workflow
    assert "Mobile E2E / Build Android debug APK" in workflow
    assert "Backend admin dashboard tests" in workflow
    assert "Vercel" in workflow
    assert "ALLOWED_BASE_REGEX" in workflow
    assert "master-production" in workflow
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
    assert "Failed step:" in workflow
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


def test_codex_autofix_docs_require_real_github_label_and_pr_template():
    ci_autofix_doc = Path("docs/ci-autofix.md").read_text(encoding="utf-8")
    codex_autofix_doc = Path("docs/codex-auto-fix.md").read_text(encoding="utf-8")
    codex_prompt = Path(".github/codex/prompts/auto-fix-ci.md").read_text(encoding="utf-8")
    non_reg_doc = Path("docs/non-regression-tests.md").read_text(encoding="utf-8")

    for content in (ci_autofix_doc, codex_autofix_doc, codex_prompt):
        assert "label GitHub" in content
        assert "codex-autofix" in content
        assert "gh pr edit <PR_NUMBER> --add-label codex-autofix" in content
        assert "gh pr view <PR_NUMBER> --json labels" in content
        assert "gh label create codex-autofix --color 5319E7 --description \"Enable Codex CI auto-fix loop\"" in content
        assert (
            "si impossible faute de permissions" in content.lower()
            or "si impossible faute de permission" in content.lower()
            or "faute de permission" in content.lower()
            or "permissions insuffisantes" in content.lower()
        )

    for content in (ci_autofix_doc, codex_prompt):
        assert "## Objectif" in content
        assert "## Changements" in content
        assert "## Label auto-fix" in content
        assert "codex-autofix requis : oui" in content
        assert "label GitHub appliqué : oui/non" in content
        assert "## Garde-fous" in content
        assert "pas d’auto-merge" in content
        assert "pas de retry infini" in content
        assert "pas de masquage d’échec Maestro" in content
        assert "## Validation" in content
        assert "## Limites restantes" in content

    assert "pas de masquage de skip Maestro" in non_reg_doc
    assert "Maestro is required but no compatible APK artifact was found." in non_reg_doc


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
    assert "gh pr create ... --label codex-autofix" in prompt
    assert "gh pr edit <PR_NUMBER_OR_URL> --add-label codex-autofix" in prompt
    assert "`gh pr view <PR_NUMBER> --json labels`" in prompt
    assert "PR créée : oui/non" in prompt
    assert "label `codex-autofix` appliqué : oui/non" in prompt


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


def test_mobile_e2e_builds_apk_automatically_when_maestro_required_without_apk_changes():
    """
    Regression: maestro_required=true, mobile_apk_required=false, reuse_apk_success=false
    must trigger automatic APK build rather than blocking with manual re-run message.

    Scenario:
    - PR modifies .maestro/ or scripts/run-maestro-e2e.sh only
    - No frontend/** or android/** changes
    - No previous APK artifacts available for reuse
    Expected: Workflow builds APK automatically, then runs Maestro
    """
    workflow = Path(".github/workflows/mobile-e2e.yml").read_text(encoding="utf-8")

    decide_build_block = workflow.split("Decide whether to build APK")[1].split("Setup Node")[0]
    assert "BUILD_APK_STEP_SHOULD_RUN=\"false\"" in decide_build_block
    assert "if [ \"${{ needs.changes.outputs.mobile_apk_required }}\" = \"true\" ]; then" in decide_build_block
    assert "BUILD_APK_STEP_SHOULD_RUN=\"true\"" in decide_build_block
    assert "elif [ \"${{ needs.changes.outputs.maestro_required }}\" = \"true\" ] && [ \"$REUSE_APK_SUCCESS\" = \"false\" ]; then" in decide_build_block
    assert "will build APK automatically" in decide_build_block
    assert "echo \"build_apk_step_should_run=$BUILD_APK_STEP_SHOULD_RUN\"" in decide_build_block

    # Verify all build steps are conditioned on decide_build output
    assert "if: steps.decide_build.outputs.build_apk_step_should_run == 'true'" in workflow.split("Setup Node")[1].split("Install frontend dependencies")[0]
    assert "if: steps.decide_build.outputs.build_apk_step_should_run == 'true'" in workflow.split("Install frontend dependencies")[1].split("Setup Java")[0]
    assert "if: steps.decide_build.outputs.build_apk_step_should_run == 'true'" in workflow.split("Setup Java")[1].split("Prebuild Android app")[0]
    assert "if: steps.decide_build.outputs.build_apk_step_should_run == 'true'" in workflow.split("Prebuild Android app")[1].split("Build debug APK")[0]
    assert "if: steps.decide_build.outputs.build_apk_step_should_run == 'true'" in workflow.split("Build debug APK")[1].split("Decide APK availability")[0]

    # Verify the decision logic in "Decide APK availability" is simplified and uses decide_build output
    apk_decision_block = workflow.split("Decide APK availability")[1].split("Upload Android debug APK artifact")[0]
    assert "steps.decide_build.outputs.build_apk_step_should_run" in apk_decision_block
    assert "[ -f e2e-apk/app-debug.apk ]" in apk_decision_block
    assert 'APK_SOURCE="built"' in apk_decision_block or 'APK_SOURCE=built' in apk_decision_block
    assert 'APK_SOURCE="reused"' in apk_decision_block or 'APK_SOURCE=reused' in apk_decision_block

    # Verify the new scenario doesn't fall into "missing APK" gate failure anymore
    not_required_gate = workflow.split("mobile-e2e-not-required:")[1].split("maestro-e2e:")[0]
    assert "Maestro is required but no compatible APK artifact was found" in not_required_gate
    assert "force_mobile_apk_build=true" in not_required_gate
    # But the new logic prevents this gate from being reached in the auto-build scenario


def test_maestro_flows_do_not_use_invalid_sleep_command():
    """
    Regression: Maestro flows must not use 'sleep:' which is not a valid Maestro command.
    Valid timing strategies: waitForAnimationToEnd, extendedWaitUntil, tapOn, etc.

    Invalid:
    - sleep: 3000

    Valid alternatives:
    - extendedWaitUntil with timeout
    - waitForAnimationToEnd
    """
    maestro_files = Path(".maestro").glob("*.yaml")

    for flow_file in maestro_files:
        content = flow_file.read_text(encoding="utf-8")

        # Ensure no sleep: command appears in Maestro flows
        lines = content.split("\n")
        for i, line in enumerate(lines, 1):
            assert not line.strip().startswith("- sleep:"), \
                f"{flow_file.name}:{i} contains invalid 'sleep:' command. Use 'extendedWaitUntil' or 'waitForAnimationToEnd' instead."


def test_auth_session_flow_protects_login_actions_with_conditions():
    """
    Regression: 01-auth-session must not impose unconditional assertions on login-email-input.

    If app is already connected (tab-home visible) or in intermediate state,
    login UI may not appear. The flow must handle both cases:
    - Case 1: tab-home already visible → skip login, assert home at end
    - Case 2: tab-home not visible → wait for login UI with CONDITIONAL runFlow when: visible

    Invalid structure (causes false positives):
    - runFlow:
        when: notVisible: tab-home
        commands:
          - extendedWaitUntil: visible: login-email-input  # ← UNCONDITIONAL assertion
          - runFlow: ...

    Valid structure (handles both cases):
    - runFlow:
        when: notVisible: tab-home
        commands:
          - runFlow:
              when: visible: login-email-input  # ← CONDITIONAL protection
              commands: ...
    """
    auth_flow = Path(".maestro/01-auth-session.yaml").read_text(encoding="utf-8")

    # Extract the "notVisible: tab-home" branch
    assert 'when:\n      notVisible:\n        id: tab-home' in auth_flow
    retry_branch = auth_flow.split('when:\n      notVisible:\n        id: tab-home')[1]
    retry_commands = retry_branch.split('commands:')[1].split('- runFlow:')[1]

    # Verify: first runFlow after "notVisible: tab-home" must have a "when:" condition
    # (not an unconditional extendedWaitUntil assertion)
    lines_after_notvisible = '\n'.join(retry_commands.split('\n')[:20])

    # Should NOT have extendedWaitUntil directly after commands:
    assert not lines_after_notvisible.strip().startswith('- extendedWaitUntil'), \
        "01-auth-session: 'notVisible: tab-home' branch has unconditional extendedWaitUntil. " \
        "Login actions must be protected by 'when: visible: login-email-input'."

    # Should have conditional runFlow
    assert 'when:\n            visible:\n              id: login-email-input' in retry_branch, \
        "01-auth-session: 'notVisible: tab-home' branch must contain 'when: visible: login-email-input' to conditionally protect login actions."


def test_mobile_e2e_reuses_apk_even_if_maestro_workflow_failed():
    """
    Regression: APK reuse should not require workflow status=success.

    Scenario: A run builds APK successfully, but Maestro flow fails later.
    The workflow status becomes 'failure', but the APK artifact is valid.
    Next run should reuse this APK, not rebuild unnecessarily.

    Issue: If the reuse_apk search filters by status=success, it will exclude
    all runs where Maestro failed, wasting build time and CI resources.

    Valid: Search ALL runs, filter on "Build Android debug APK" job.conclusion == success
    Invalid: Search only status=success runs (workflow-level, too strict)
    """
    workflow = Path(".github/workflows/mobile-e2e.yml").read_text(encoding="utf-8")

    # Find the "Try reusing existing PR APK artifact" step
    reuse_step = workflow.split("Try reusing existing PR APK artifact")[1].split("Decide whether to build APK")[0]

    # Verify: the gh api call does NOT filter by status=success
    # (it filters on the Build job conclusion later, which is correct)
    assert 'actions/runs?event=pull_request&per_page=100' in reuse_step, \
        "APK reuse search should query all runs, not just status=success"

    assert 'status=success' not in reuse_step.split('CANDIDATE_RUNS_JSON')[0], \
        "APK reuse must not filter by workflow status=success (too strict). " \
        "It should query all runs and filter by Build job conclusion instead."

    # Verify: the job filtering logic exists and is correct
    assert '.name == "Mobile E2E / Build Android debug APK" and .conclusion == "success"' in reuse_step, \
        "APK reuse must filter runs where the Build job specifically succeeded."


def test_auth_session_flow_captures_initial_state_and_unknown_state():
    """
    Regression: 01-auth-session must capture diagnostic screenshots
    to identify when app is in an unexpected state (neither home nor login visible).

    This prevents silent failures where the flow times out without explanation,
    making debugging difficult.

    Expected screenshots:
    - 01-auth-session-initial-state: right after launchApp + waitForAnimationToEnd
    - 01-auth-session-after-submit: after login submit, before waiting for home
    - 01-auth-session-before-final-assert: diagnostic before final assertion
    """
    auth_flow = Path(".maestro/01-auth-session.yaml").read_text(encoding="utf-8")

    # Verify initial screenshot is captured right after launchApp
    assert 'takeScreenshot: 01-auth-session-initial-state' in auth_flow, \
        "01-auth-session must capture initial state after launchApp for debugging"

    # Verify after-submit screenshot is captured
    assert 'takeScreenshot: 01-auth-session-after-submit' in auth_flow, \
        "01-auth-session must capture state after login submit for debugging"

    # Verify final diagnostic screenshot is captured
    assert 'takeScreenshot: 01-auth-session-before-final-assert' in auth_flow, \
        "01-auth-session must capture state before final assertion for clear diagnostics"

    # Verify the final diagnostic branch exists and has proper logic
    flow_lines = auth_flow.split('\n')
    final_diagnostic_found = False
    for i, line in enumerate(flow_lines):
        if '01-auth-session-before-final-assert' in line:
            # Check that this screenshot is followed by an assertion (assertVisible)
            remaining = '\n'.join(flow_lines[i:i+10])
            assert 'assertVisible' in remaining, \
                "Final diagnostic screenshot must be followed by an assertion for clear diagnostics"
            final_diagnostic_found = True
            break

    assert final_diagnostic_found, \
        "01-auth-session must have a final diagnostic branch that captures state with assertion"


def test_auth_session_flow_handles_three_states_explicitly():
    """
    Regression: 01-auth-session must explicitly handle three distinct scenarios:
    1. Already connected (tab-home visible)
    2. Login required (login-email-input visible)
    3. Unknown state (neither visible) → diagnostic + assertion

    The flow must not silently skip or timeout without indication of state.
    """
    auth_flow = Path(".maestro/01-auth-session.yaml").read_text(encoding="utf-8")

    # State 1: Already connected
    assert 'when:\n      visible:\n        id: tab-home' in auth_flow, \
        "01-auth-session must have explicit branch: if tab-home visible, already connected"

    # State 2: Login required
    assert 'when:\n      visible:\n        id: login-email-input' in auth_flow, \
        "01-auth-session must have explicit branch: if login-email-input visible, perform login"

    # State 3: Unknown state - check for the notVisible branch after retry
    assert 'when:\n      notVisible:\n        id: login-email-input' in auth_flow, \
        "01-auth-session must have explicit branch: if neither tab-home nor login visible, capture diagnostic"

    # Final assertions
    assert 'assertVisible:\n          id: tab-home' in auth_flow, \
        "01-auth-session must have strong final assertion on tab-home"


def test_auth_session_flow_has_complete_diagnostic_screenshots():
    """
    Regression: 01-auth-session must capture diagnostic screenshots at every branch point
    and state transition. This allows CI failure investigation without guessing.

    Required screenshots (must be named exactly as follows):
    - 01-auth-session-initial-state: right after launchApp + waitForAnimationToEnd
    - 01-auth-session-already-authenticated: if tab-home visible at start
    - 01-auth-session-login-screen-visible: before attempting login
    - 01-auth-session-after-submit: immediately after login submit tap
    - 01-auth-session-retry-login-visible: if login screen visible after initial not-home
    - 01-auth-session-retry-after-submit: after retry login submit
    - 01-auth-session-before-final-assert: final diagnostic before assertion
    """
    auth_flow = Path(".maestro/01-auth-session.yaml").read_text(encoding="utf-8")

    required_screenshots = [
        "01-auth-session-initial-state",
        "01-auth-session-already-authenticated",
        "01-auth-session-login-screen-visible",
        "01-auth-session-after-submit",
        "01-auth-session-retry-login-visible",
        "01-auth-session-retry-after-submit",
        "01-auth-session-before-final-assert",
    ]

    for screenshot_name in required_screenshots:
        assert f"takeScreenshot: {screenshot_name}" in auth_flow, \
            f"01-auth-session must capture '{screenshot_name}' screenshot for diagnostics"

    # Verify no invalid sleep: command
    lines = auth_flow.split("\n")
    for i, line in enumerate(lines, 1):
        assert not line.strip().startswith("- sleep:"), \
            f"Line {i}: invalid 'sleep:' command in 01-auth-session. Use Maestro commands only."


def test_auth_session_flow_login_not_mandatory_at_start():
    """
    Regression: 01-auth-session must not start with a mandatory assertion on login-email-input.

    The flow must first check if tab-home is visible (already authenticated),
    then check if login-email-input is visible, then handle unknown state.

    Invalid: Starting with assertVisible: login-email-input
    Valid: Starting with conditional runFlow when: visible: tab-home
    """
    auth_flow = Path(".maestro/01-auth-session.yaml").read_text(encoding="utf-8")

    # Check that flow doesn't start by asserting on login-email-input
    flow_start = auth_flow.split("- launchApp")[1][:500]
    assert "assertVisible:\n          id: login-email-input" not in flow_start, \
        "01-auth-session must NOT start with mandatory assertion on login-email-input"

    # Check that first branch after screenshot is conditional on tab-home
    branch_text = auth_flow.split("01-auth-session-initial-state")[1][:300]
    assert "when:\n      visible:\n        id: tab-home" in branch_text, \
        "01-auth-session first branch must check if already authenticated (tab-home visible)"


def test_mobile_e2e_has_kvm_diagnostics_before_emulator():
    """
    Regression: mobile-e2e.yml must provide KVM diagnostics before emulator.

    GitHub Actions runners typically don't have KVM hardware acceleration available,
    causing slow (~3-7 minute) emulator boot times. Without KVM, emulator falls back
    to software TCG emulation.

    Solution: Include diagnostic step that checks KVM availability for debugging.

    The diagnostic step:
    - Checks if /dev/kvm exists
    - Checks if /dev/kvm is readable/writable
    - Logs the result for debugging
    - Does NOT force configuration, just informs

    Emulator configuration uses correct syntax from action documentation:
    - api-level: 34
    - arch: x86_64
    - emulator-options: must include all necessary flags with correct syntax
      (action replaces ALL defaults, so must be explicit)
    - MAESTRO_DRIVER_STARTUP_TIMEOUT: 180000 (sufficient for slow CI)
    """
    workflow = Path(".github/workflows/mobile-e2e.yml").read_text(encoding="utf-8")

    # Verify KVM diagnostic step exists before Maestro
    assert "Diagnose KVM and hardware acceleration" in workflow, \
        "mobile-e2e.yml must include KVM diagnostics step before emulator"

    kvm_section = workflow.split("Diagnose KVM")[1].split("Run Maestro E2E suite")[0]

    # Verify diagnostic checks /dev/kvm existence
    assert "/dev/kvm" in kvm_section, \
        "KVM diagnostic must check /dev/kvm existence"

    # Verify diagnostic checks accessibility (read/write)
    assert "-r /dev/kvm" in kvm_section or "readable" in kvm_section, \
        "KVM diagnostic must check if /dev/kvm is readable"

    # Verify diagnostic logs result for debugging
    assert "HARDWARE_ACCEL=" in kvm_section, \
        "KVM diagnostic must log hardware acceleration status"

    # Find the actual Maestro runner config
    maestro_step = workflow.split("Run Maestro E2E suite")[1].split("Upload E2E artifacts")[0]

    # Verify emulator-options uses correct syntax (action doc requirements)
    if "emulator-options:" in maestro_step:
        # If options are specified, verify correct flag names per action documentation
        assert "-noaudio" in maestro_step or "noaudio" in maestro_step, \
            "emulator-options must use '-noaudio' (not '-no-audio') per action documentation"
        assert "-no-boot-anim" in maestro_step, \
            "emulator-options must include '-no-boot-anim' from action defaults"
        assert "-gpu swiftshader_indirect" in maestro_step, \
            "emulator-options should include '-gpu swiftshader_indirect' for consistent rendering"

    assert "disable-linux-hw-accel:" not in maestro_step, \
        "mobile-e2e.yml must NOT use disable-linux-hw-accel parameter (not standard for this action)"

    # Verify essential config remains intact
    assert 'MAESTRO_DRIVER_STARTUP_TIMEOUT: "180000"' in maestro_step, \
        "mobile-e2e.yml must maintain MAESTRO_DRIVER_STARTUP_TIMEOUT for slow emulator boots"

    assert "api-level: 34" in maestro_step, \
        "mobile-e2e.yml must use api-level 34 for consistent Maestro compatibility"

    assert "arch: x86_64" in maestro_step, \
        "mobile-e2e.yml must use x86_64 architecture for consistent emulation"


def test_maestro_runner_waits_for_android_package_manager_before_apk_install():
    """
    Regression: CI was failing with "cmd: Can't find service: package" during adb install
    because APK installation was attempted before Android Package Manager was ready.

    Scenario:
    - Emulator boots but Package Manager initialization is still in progress
    - adb install was called too early → transitional error
    Expected: Script waits for Package Manager readiness before adb install

    This test verifies the fix prevents future regressions:
    1. APK installation must not happen immediately after emulator boot
    2. Script must explicitly verify Package Manager readiness with cmd package list packages
    3. Script must retry APK installation if it fails due to Package Manager not ready
    4. Transient errors are retried; real errors fail cleanly
    """
    runner_script = Path("scripts/run-maestro-e2e.sh").read_text(encoding="utf-8")

    # Verify wait_for_package_manager_ready function exists
    assert "wait_for_package_manager_ready()" in runner_script, \
        "scripts/run-maestro-e2e.sh must define wait_for_package_manager_ready() function"

    # Extract function body
    pm_ready_section = runner_script.split("wait_for_package_manager_ready()")[1].split("install_apk_with_retry()")[0]

    # Verify it checks Package Manager with cmd package list packages
    assert "adb shell cmd package list packages" in pm_ready_section, \
        "wait_for_package_manager_ready must verify Package Manager using 'adb shell cmd package list packages'"

    # Verify it has retry loop with max_attempts
    assert "max_attempts=" in pm_ready_section, \
        "wait_for_package_manager_ready must have configurable max_attempts"

    # Verify it waits between retries
    assert "sleep" in pm_ready_section, \
        "wait_for_package_manager_ready must include sleep between retries"

    # Verify it logs readiness status
    assert "Package Manager is ready" in pm_ready_section, \
        "wait_for_package_manager_ready must log when Package Manager is ready"

    # Verify adb install happens in install_apk_with_retry function
    assert "install_apk_with_retry()" in runner_script, \
        "scripts/run-maestro-e2e.sh must define install_apk_with_retry() function"

    install_section = runner_script.split("install_apk_with_retry()")[1].split("ensure_apk_installed()")[0]
    assert "adb install -r e2e-apk/app-debug.apk" in install_section, \
        "install_apk_with_retry must call adb install"

    # Verify install_apk_with_retry has retry logic
    assert "max_attempts" in install_section, \
        "install_apk_with_retry must have retry logic with max_attempts"

    # Verify call order: wait_for_package_manager_ready BEFORE install_apk_with_retry
    pm_order = runner_script.find("wait_for_package_manager_ready")
    install_order = runner_script.find("install_apk_with_retry")
    assert pm_order < install_order, \
        "wait_for_package_manager_ready must be called BEFORE install_apk_with_retry"

    # Verify adb install is NOT called immediately at script start (old broken behavior)
    script_start = runner_script.split("if [ \"$MAESTRO_SUITE\" != \"smoke\" ]")[0]
    assert "adb install" not in script_start, \
        "adb install must NOT be called before emulator readiness checks (regression)"

    # Verify the call sequence: ensure_emulator_ready → wait_for_boot_completed → wait_for_package_manager_ready → install_apk_with_retry
    call_sequence = """ensure_emulator_ready
wait_for_boot_completed
wait_for_package_manager_ready
install_apk_with_retry"""
    for line in call_sequence.split('\n'):
        assert line in runner_script, \
            f"scripts/run-maestro-e2e.sh must call {line} in correct sequence"

    # Verify ensure_apk_installed is called AFTER install_apk_with_retry
    ensure_install_order = runner_script.find("ensure_apk_installed")
    assert ensure_install_order > install_order, \
        "ensure_apk_installed must be called AFTER install_apk_with_retry"
