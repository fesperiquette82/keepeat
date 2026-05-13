# Task Flow — Development Workflow for KeepEat

> Workflow for bug fixes, features, and refactors on both frontend and backend.

## Phase 1: Scope & Context

1. **Restate the demand clearly**
   - Is it a bug fix, new feature, or refactor?
   - What's the acceptance criterion (user perspective)?
   - Which stack(s) are affected (frontend, backend, both)?

2. **Load context**
   - Read `.ai/core-rules.md` (universal rules)
   - Read `.ai/task-flow.md` (this file)
   - Read `.ai/test-policy.md` (testing policy)
   - Read `.ai/review-checklist.md` (self-review template)
   - For frontend: read `.ai/stacks/react-native-expo.md`
   - For backend: read `.ai/stacks/python-fastapi.md`
   - For E2E: read `.ai/stacks/e2e-maestro.md`

3. **Identify existing patterns**
   - Search codebase for similar implementations
   - Reuse hooks, utilities, components if they exist
   - Check AUDIT_BUGS.md for related issues

## Phase 2: Test-Driven Development (TDD)

4. **Write test first (before implementation)**
   - **Bug fix**: Test fails on current main (reproduces bug), passes after fix
   - **Feature**: Test describes intended behavior, fails initially (red)
   - **Test location**:
     - Frontend: `frontend/__tests__/` or co-located `.test.ts`
     - Backend: `backend/tests/` with appropriate suite

5. **Verify test fails (red phase)**
   - Run tests locally: `npm run test:ci` (frontend) or `pytest backend/tests/` (backend)
   - Confirm test actually fails before fix is applied
   - This proves test is not accidental green

## Phase 3: Implementation

6. **Implement minimum to make tests pass (green phase)**
   - Write only code needed to pass test
   - No premature abstractions, no "future-proof" features
   - Follow stack conventions (see `.ai/stacks/`)
   - Reuse existing patterns from codebase

7. **Refactor if needed (blue phase)**
   - Improve code quality, extract duplication (three+ similar lines)
   - Ensure tests still pass
   - No functional changes in this phase

## Phase 4: Validation

8. **Run full validation locally**
   - Execute `./scripts/ai-validate.sh` (full suite)
   - This runs:
     - Frontend: lint, typecheck, unit/integration/smoke tests
     - Backend: lint (ruff, black), type check (mypy), pytest
     - E2E: Maestro tests (if not --quick)
   - **Must exit 0** before proceeding

9. **Alternative: Quick validation before commit**
   - Run `./scripts/ai-validate.sh --quick` (no test phase)
   - Faster feedback loop during development
   - Full validation required before push (pre-push hook)

## Phase 5: Self-Review

10. **Check against `review-checklist.md`**
    - Correctness: Does it solve the problem?
    - Tests: Are tests comprehensive?
    - Code quality: Is it readable and maintainable?
    - Integration: Does it break other features?
    - Git: Are commits clean and well-messaged?
    - Security: No credentials, no XSS/injection, no secrets in logs?

11. **Report findings**
    - ✓ Pass: Move to commit
    - ✗ Blocker: Fix before commit
    - ⚠ Warning: Document reasoning if waiving requirement

## Phase 6: Commit & Push

12. **Commit with clear message**
    ```
    <type>(<scope>): <description>
    
    [Optional body explaining why this change matters]
    
    Fixes #<issue-number> (if bug fix)
    ```
    - Pre-commit hook runs: `verify-tests-added.mjs` (fails if tests not added)

13. **Push to remote**
    - Pre-push hook runs: `./scripts/ai-validate.sh` (full validation, may take time)
    - If it fails: fix locally, push again
    - If it passes: remote branch created

14. **Create Pull Request**
    - Title: Clear, under 70 chars
    - Description: Explain problem + solution
    - Link related issues: "Fixes #123"
    - Wait for CI to pass (GitHub Actions)
    - Request review

## Phase 7: CI & Merge

15. **GitHub Actions validation**
    - `frontend-pr-checks`: npm lint, typecheck, test:ci
    - `backend-pr-checks`: pytest critical suites
    - `policy-pr-checks`: verify-tests-added.mjs (enforces regression tests)
    - All must pass before merge

16. **Code review**
    - Peer review (if team) or self-review
    - Ensure changes align with acceptance criteria
    - Merge to main (auto-merge or manual depending on policy)

---

## Shortcuts

### Quick test during development
```bash
npm run test:unit           # Frontend unit tests only
npm run test:integration    # Frontend integration tests only
pytest backend/tests/test_<name>.py  # Specific backend test
```

### Full local validation before push
```bash
./scripts/ai-validate.sh
```

### Quick lint + typecheck (skip tests)
```bash
./scripts/ai-validate.sh --quick
```

---

## When Stuck

1. **Test fails for mysterious reason** → Check test setup, fixtures, mocks
2. **Implementation doesn't match test** → Re-read test, ensure it's testing behavior not impl
3. **Multiple features interact** → Split into smaller PRs, test each in isolation
4. **Legacy code doesn't have tests** → Write tests as you go, don't skip
5. **Performance regression** → Profile first, then optimize minimal code path

---

## Notes

- **Parallel work**: Frontend and backend tests run in parallel (can work on both simultaneously)
- **E2E is last**: Maestro tests run last, after unit/integration pass
- **Test coverage**: Use as indicator, not target (100% coverage can hide bad tests)
- **Regression tests**: Keep them close to the bug they prevent (same file if possible)
