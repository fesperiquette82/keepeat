# Review Checklist — Self-Review Before Commit

> Template for AI agents and developers to self-review changes.
> Report: ✓ (pass), ✗ (blocker), ⚠ (decision required)

---

## Correctness

- [ ] ✓ Does the implementation solve the stated problem?
- [ ] ✓ Does it match the acceptance criteria / test expectations?
- [ ] ✓ Have I tested the golden path AND edge cases?
- [ ] ✓ Are error cases handled gracefully (log + crash cleanly, don't swallow)?
- [ ] ✗ **Blocker**: No unhandled exceptions or silent failures

---

## Tests

- [ ] ✓ Are tests written for all behavior changes?
- [ ] ✓ Do regression tests exist (for bug fixes)?
- [ ] ✓ Have tests been verified to fail first (red phase)?
- [ ] ✓ Test names describe behavior, not implementation?
- [ ] ✓ Tests use realistic data, not excessive mocks?
- [ ] ✓ No snapshots in frontend tests (React Native convention)?
- [ ] ✗ **Blocker**: Code change without corresponding test

---

## Code Quality

### Frontend (React Native + TypeScript)

- [ ] ✓ TypeScript: No `any` types (or `any` has comment explaining why)
- [ ] ✓ No `console.log` in production code (use debug config)
- [ ] ✓ Components are reusable (not one-off implementations)
- [ ] ✓ Hooks are extracted (no 200-line components)
- [ ] ✓ ESLint clean: `npm run lint` passes
- [ ] ✓ No dead code or commented-out lines
- [ ] ✗ **Blocker**: ESLint errors

### Backend (Python + FastAPI)

- [ ] ✓ mypy clean: `mypy backend/` passes (no `type: ignore`)
- [ ] ✓ Pydantic models validate input
- [ ] ✓ No bare `except` clauses
- [ ] ✓ Functions are testable (DI via Depends, not globals)
- [ ] ✓ No hardcoded values (use config)
- [ ] ✓ No dead code or commented-out lines
- [ ] ✗ **Blocker**: mypy errors or unhandled exceptions

### Both

- [ ] ✓ No credentials, API keys, or secrets in code
- [ ] ✓ No large binary files committed
- [ ] ✓ No node_modules, __pycache__, .venv in git

---

## Integration

- [ ] ✓ Does this change break existing features?
  - Ran full `./scripts/ai-validate.sh` locally?
  - All tests pass (frontend + backend)?
- [ ] ✓ Does it integrate cleanly with nearby code?
- [ ] ✓ Are dependencies up-to-date (no version conflicts)?
- [ ] ✓ Database migrations (if needed) are reversible?
- [ ] ⚠ **Decision**: Does this need documentation update?

---

## Git & Commit

- [ ] ✓ Commit message follows format:
  ```
  <type>(<scope>): <description>
  
  [Why this change matters]
  
  Fixes #<issue-number>
  ```
- [ ] ✓ One feature/fix per commit (not mixed concerns)
- [ ] ✓ No merge commits (rebase if needed)
- [ ] ✓ No `--no-verify`, `--force`, or other bypasses
- [ ] ✓ Pre-commit hook passes: `verify-tests-added.mjs`
- [ ] ✗ **Blocker**: Pre-commit hook fails

---

## Security

- [ ] ✓ No SQL injection risk (use parameterized queries)
- [ ] ✓ No XSS risk (React auto-escapes, but check custom HTML)
- [ ] ✓ No CSRF risk (API validates origin if needed)
- [ ] ✓ No hardcoded credentials
- [ ] ✓ Third-party libraries are from trusted sources
- [ ] ✓ No new console.error output that exposes internals
- [ ] ✗ **Blocker**: Security vulnerability

---

## Documentation

- [ ] ⚠ Does code need comments?
  - If WHY is non-obvious: add one-liner
  - If implementation is straightforward: no comment needed
- [ ] ⚠ Does API need docs (if external-facing)?
- [ ] ⚠ Does configuration need update?

---

## AI Agent Summary

Report your findings before commit:

```
## Self-Review Report

✓ **Correctness**: [brief finding]
✓ **Tests**: [brief finding]
✗ **Code Quality**: [blocker details]
✓ **Integration**: [brief finding]
✓ **Git**: [brief finding]
✓ **Security**: [brief finding]
⚠ **Documentation**: [decision point]

**Blockers**: None
**Decisions needed**: [list any ⚠ items]
**Ready to commit**: YES / NO
```

---

## Red Flags (Never Commit With These)

1. ❌ Tests failing locally (even one)
2. ❌ Linter errors
3. ❌ Type errors
4. ❌ Dead code from previous attempts
5. ❌ Credentials or secrets in code
6. ❌ Mocking business logic
7. ❌ Skipped or disabled tests
8. ❌ `--no-verify` commits
9. ❌ Force-push history
10. ❌ Unresolved ⚠ decisions

---

## Green Flags (Good Signs)

✅ All tests pass (frontend + backend + E2E smoke)
✅ No linter errors
✅ No type errors
✅ Test coverage increased (or maintained)
✅ Code follows existing patterns
✅ Clear, atomic commits
✅ Regression tests for bug fixes
✅ Documentation updated
✅ Only code changes needed for feature (no scope creep)
