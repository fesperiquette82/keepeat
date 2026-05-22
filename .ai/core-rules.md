# Core Rules — Universal, Non-Negotiable

> Source of truth for all IA agents (Claude Code, Cursor, Copilot, Codex).
> These rules apply to all stacks (frontend, backend, E2E).

## Testing Mandate

1. **Every bug fix → regression test (mandatory)**
   - Test must fail before fix is applied
   - Test must verify the bug is actually fixed
   - Place test in `backend/tests/` or `frontend/__tests__/`

2. **Every new feature → acceptance test (mandatory)**
   - Test describes intended behavior (not implementation)
   - Place test in appropriate suite (unit, integration, smoke)

3. **Never suppress, disable, or weaken existing tests without written justification**
   - No `.skip()`, `.only()`, `# pytest.mark.skip`, `x.test.ts`, etc.
   - No reducing coverage thresholds
   - No removing assertions from existing tests

4. **Never mock the logic being tested**
   - ❌ Mock the API logic you're building
   - ❌ Mock domain models, business rules, algorithms
   - ✅ Mock external I/O: network calls, databases, filesystem, time, random
   - ✅ Mock third-party services (OCR, payment APIs, etc.)

5. **Test behavior, not implementation**
   - Test what the user sees or the API returns
   - Not: "method calls database", but "returns correct recipe list"
   - Not: "stores in Redux", but "state reflects user action"

6. **User-visible bugs require 3-level test coverage (mandatory)**
   - **Definition**: Bug is "user-visible" if user perceives incorrect behavior (UI, API response, data)
   - **Not user-visible**: Bug in internal utilities, types, build process
   - **Required coverage**:
     1. **Unit test** — Smallest logic involved (function, hook, validator)
     2. **Integration test** — Data boundary (component interaction, API contract, state flow)
     3. **UI/E2E test** — Visible behavior (screen state, gesture response, API result shown)
   - **If a level is impossible**: Document why in commit message (e.g., "No E2E — gesture testing requires physical device")
   - **Enforcement**: Pre-commit hook warns if tests missing for visible bugs

## Development Discipline

6. **Inspect first, modify second**
   - Read existing code patterns before writing new code
   - Reuse hooks, utilities, patterns already defined in the codebase
   - Avoid code duplication (three similar lines → consider extraction)

7. **Product rules (KeepEat-specific)**
   - No fake-personalized UI (e.g., don't show fallback recipes as "Your picks")
   - No scattered `console.log` dispersed across code
   - No parallel data flows for same product (one source of truth per entity)
   - Debug tools accessible only via config flag, never shown to end users
   - Never suppress legitimate errors (log → crash cleanly, don't swallow)

8. **Code quality**
   - TypeScript strict mode (frontend)
   - mypy strict mode (backend)
   - ESLint clean (frontend)
   - No type: ignore, no any (unless genuinely unavoidable + commented)

## Validation & Commits

9. **Before every commit / PR**
   - Run `./scripts/ai-validate.sh` locally (blocks on failure)
   - Confirm all tests pass (backend AND frontend)
   - Review changes against `review-checklist.md`

10. **Git discipline**
    - ❌ `git push --force`
    - ❌ `git commit --no-verify`
    - ❌ Force-pushing to main/develop
    - ✅ Create feature branch, push normally, open PR
    - ✅ Let pre-push hook validate before push

11. **Commit message format**
    ```
    <type>(<scope>): <description>
    
    [Optional body explaining why]
    
    Fixes #<issue-number> (if applicable)
    ```
    - type: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
    - scope: affected component (e.g., `recipes`, `auth`, `ocr`)

## Governance Enforcement

12. **CI gates are non-negotiable**
    - Tests must pass in CI before merge
    - Policy enforcement (verify-tests-added.mjs) blocks PRs missing tests
    - Coverage reports are informative, not gates (but regressions matter)

13. **AI agent auto-review**
    - Before proposing commit: self-review against `review-checklist.md`
    - Report ✓ (pass), ✗ (blocker), ⚠ (requires human decision)
    - Never commit with unresolved ⚠ issues
    - Document reasoning for any waivers

## AUDIT_BUGS.md

14. **Bug tracking**
    - All known bugs tracked in AUDIT_BUGS.md
    - Statuses: OUVERT (open), EN COURS (in progress), CORRIGÉ (fixed), IGNORÉ (ignored)
    - Severity: 🔴 CRITIQUE, 🟠 MAJEUR, 🟡 MINEUR
    - When fixing a bug → update AUDIT_BUGS.md

---

## When in Doubt

- **Priority 1**: Read `.ai/core-rules.md` (this file)
- **Priority 2**: Read `.ai/task-flow.md` (workflow)
- **Priority 3**: Read `.ai/test-policy.md` (test architecture)
- **Priority 4**: Read `.ai/review-checklist.md` (self-review template)
- **Priority 5**: Read `.ai/stacks/<stack>.md` (stack-specific patterns)
- **Priority 6**: Ask humans (don't invent rules)

**Never**:
- Invent rules not in `.ai/`
- Contour tests to pass CI
- Hide errors or suppress warnings
- Assume "it'll work in prod" when it fails locally
