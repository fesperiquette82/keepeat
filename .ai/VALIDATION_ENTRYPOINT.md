# Single Validation Entrypoint (Rule 9)

> **Canonical command**: `./scripts/ai-validate.sh`  
> **Enforcement**: Rule 9, `.ai/core-rules.md`  
> **Status**: ✅ Active since 2026-05-22

---

## Why Single Entrypoint?

### Problem It Solves
- ❌ Developers run different commands: `npm run test`, `npm run lint`, `pytest backend/tests/`
- ❌ CI runs yet another set of commands
- ❌ Gaps between local validation and CI validation
- ❌ Inconsistent validation across team

### Solution
- ✅ **ONE command** for all validation
- ✅ **Consistent** across developers and CI
- ✅ **Easy to remember** and maintain
- ✅ **Extensible** without breaking existing workflows

---

## The Canonical Command

### Quick Mode (Development)
```bash
./scripts/ai-validate.sh --quick
```

**What it runs:**
- ESLint (frontend)
- TypeScript type check (frontend)
- mypy type check (backend)
- Ruff/Black formatting (backend, if configured)

**Time**: ~30-60 seconds  
**Use case**: Fast feedback during development

---

### Full Mode (Pre-Push/Final Validation)
```bash
./scripts/ai-validate.sh
# or explicitly:
./scripts/ai-validate.sh --full
```

**What it runs:**
- All from `--quick` PLUS:
- Frontend unit tests (`npm run test:unit`)
- Frontend integration tests (`npm run test:integration`)
- Frontend smoke tests (`npm run test:smoke`)
- Backend pytest (all suites)
- Policy check: `verify-tests-added.mjs` (tests added for code changes)

**Time**: 2-5 minutes  
**Use case**: Before pushing to remote, before PR review

---

## Usage Workflow

### Development Flow
```bash
# 1. Make code changes
git add src/component.ts

# 2. Quick check (before staging)
./scripts/ai-validate.sh --quick

# 3. If all good, stage and commit
git add .
git commit -m "feat(component): add new feature"

# 4. Pre-push: Full validation
./scripts/ai-validate.sh

# 5. Push
git push origin feature-branch
```

### What Hook Runs
```bash
# Pre-commit hook (.husky/pre-commit)
node scripts/verify-tests-added.mjs HEAD~1   # ← NOT full validation

# Pre-push hook (.husky/pre-push)
./scripts/ai-validate.sh                      # ← FULL validation
```

---

## What NOT to Do

### ❌ WRONG: Alternative validation commands
```bash
# DO NOT do these:
npm run test              # ← Too narrow (frontend only)
npm run lint              # ← Too narrow (no tests)
cd backend && pytest      # ← Too narrow (backend only)
npm run typecheck         # ← Too narrow (no lint or tests)
cd frontend && npm run test:ci  # ← Changes working directory
```

### ✅ RIGHT: Use canonical command
```bash
# DO THIS:
./scripts/ai-validate.sh --quick

# or for final validation:
./scripts/ai-validate.sh
```

---

## What Happens If Script Is Broken

**Rule**: Do not work around it. Fix it.

### Example: TypeScript Check Fails
```bash
$ ./scripts/ai-validate.sh --quick
...
❌ TypeScript type check failed
mypy: command not found
```

**WRONG** (working around):
```bash
# Don't do this:
cd frontend && npm run test:ci  # ← Avoid the typecheck
```

**RIGHT** (fixing the entrypoint):
```bash
# 1. Investigate:
which mypy
pip list | grep mypy

# 2. Fix the script or environment:
pip install mypy  # or update .ai/core-rules.md to explain why

# 3. Now run canonical command again:
./scripts/ai-validate.sh --quick
```

---

## Script Exit Codes

```bash
./scripts/ai-validate.sh --quick
echo $?
```

| Code | Meaning |
|------|---------|
| **0** | ✅ All validations passed |
| **1** | ❌ At least one validation failed |

---

## For AI Agents & Developers

### When Using the Script

**✅ DO:**
- Use `./scripts/ai-validate.sh --quick` during development
- Use `./scripts/ai-validate.sh` before push/PR
- Follow the exit code (0 = good, 1 = fix needed)
- Fix issues reported by the script

**❌ DON'T:**
- Invent alternative validation commands
- Skip the canonical script "because it's faster"
- Run `npm run test` instead of `./scripts/ai-validate.sh`
- Use `--no-verify` to bypass pre-push hook
- Run partial validation (lint-only, test-only)

---

## Script Structure

```
./scripts/ai-validate.sh [OPTIONS]
├── Parse arguments (--quick, --stacks)
├── Detect stacks (frontend, backend, e2e)
├── For each stack:
│   ├── Lint check (ESLint, Ruff)
│   ├── Format check (Black)
│   ├── Type check (TypeScript, mypy)
│   └── [If NOT --quick]
│       ├── Unit tests
│       ├── Integration tests
│       └── E2E tests
└── Policy check: verify-tests-added.mjs [If NOT --quick]
```

---

## Troubleshooting

### Issue: Script hangs on tests
```
./scripts/ai-validate.sh
# Seems to hang...
```

**Solution**:
1. Check for infinite loops in test setup
2. Add timeout: `timeout 300 ./scripts/ai-validate.sh` (5 min timeout)
3. Run specific stack: `./scripts/ai-validate.sh --stacks react-native-expo`

---

### Issue: "Unknown option" error
```
./scripts/ai-validate.sh -q
Unknown option: -q
```

**Solution**: Use full flag name
```bash
./scripts/ai-validate.sh --quick  # NOT -q
```

---

### Issue: Stack detection fails
```
❌ No stacks detected.
```

**Solution**: Ensure project files exist
- Frontend: `frontend/package.json`, `frontend/app.json`
- Backend: `backend/requirements.txt` or `backend/pyproject.toml`

---

## Integration with CI

### GitHub Actions
```yaml
jobs:
  validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Setup Node
        uses: actions/setup-node@v5
      - name: Setup Python
        uses: actions/setup-python@v5
      - name: Run validation
        run: ./scripts/ai-validate.sh  # ← Canonical command in CI too!
```

---

## When to Update the Script

The canonical command should be updated when:
- New validation tool is added (new linter, test framework)
- Stack changes significantly
- Validation flow needs optimization

**Process**:
1. Update `./scripts/ai-validate.sh`
2. Update this documentation
3. Update `.ai/core-rules.md` if needed
4. Announce to team: "New canonical validation available"

---

## Examples from KeepEat

### BUG-021 (Swipe Actions) Validation
```bash
# Developer working on fix:
$ ./scripts/ai-validate.sh --quick
[validate] React Native + Expo (Frontend)
✓ ESLint passed
✓ TypeScript type check passed

# Before pushing fix:
$ ./scripts/ai-validate.sh
[validate] React Native + Expo (Frontend)
✓ ESLint passed
✓ TypeScript type check passed
[step] Running frontend tests...
  → Unit tests: PASSED (test_swipeHandler.test.ts)
  → Integration tests: PASSED (stockSwipeActions.integration.test.ts)
  → Smoke tests: PASSED

[validate] Python + FastAPI (Backend)
✓ All backend tests passed

✅ ALL VALIDATIONS PASSED
```

---

## Related Rules

- **Rule 9.1** (this): Single validation entrypoint
- **Rule 10**: Before every commit
- **Rule 13**: CI gates
- **Script**: `.husky/pre-push` (runs full validation before push)
- **Script**: `.husky/pre-commit` (quick checks, not full validation)

---

## FAQ

### Q: Can I use --quick before push?
**A**: No. Use `--quick` only during development. Before push/PR, run full validation: `./scripts/ai-validate.sh`

### Q: What if I'm in a hurry?
**A**: The `--quick` mode is still there for rapid feedback during development. But before pushing, must run full validation.

### Q: Can we add `--fast` as alias for `--quick`?
**A**: No. Single entrypoint means single interface. If users invent aliases, consistency breaks.

### Q: What if a test is flaky?
**A**: Fix it. Don't skip it. If truly unavoidable, document in commit message and .ai/test-policy.md.

### Q: Can I run validation from another directory?
**A**: The script should handle it, but best practice: run from repo root: `./scripts/ai-validate.sh`

---

**Canonical command**: `./scripts/ai-validate.sh`  
**Quick mode**: `./scripts/ai-validate.sh --quick`  
**Full mode**: `./scripts/ai-validate.sh` (default)  
**Never invent alternatives**.
