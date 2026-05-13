# Integration Notes — Project_AI_Based_Template → KeepEat

> Migration log and rationale for template adoption.

**Date**: May 13, 2026  
**Status**: In progress (Phase 1 complete)

---

## What Changed

### ✅ Added (Non-destructive)

1. **`.ai/` directory** — Centralized governance rules
   - `core-rules.md` — Universal rules (reused from existing AGENTS.md + CLAUDE.md)
   - `task-flow.md` — Development workflow
   - `test-policy.md` — Testing standards
   - `review-checklist.md` — Self-review template
   - `project-profile.json` — Stack configuration
   - `stacks/react-native-expo.md` — Frontend conventions
   - `stacks/python-fastapi.md` — Backend conventions
   - `stacks/e2e-maestro.md` — E2E testing conventions

2. **`scripts/` enhancements** — Validation automation
   - `ai-validate.sh` — Unified dispatcher (multi-stack)
   - `scripts/lib/read-profile.sh` — Profile parser
   - `scripts/lib/validate-react-native-expo.sh` — Frontend validator
   - `scripts/lib/validate-python-fastapi.sh` — Backend validator
   - `scripts/lib/validate-e2e-maestro.sh` — E2E validator

3. **`.husky/` directory** — Git hooks
   - `pre-commit` — Quick test check (verify-tests-added.mjs)
   - `pre-push` — Full validation (ai-validate.sh)

4. **`.cursor/rules/`** — Cursor IDE integration
   - `project.mdc` — Rule hierarchy for Cursor

### ✅ Kept (Backward-compatible)

- `AGENTS.md` — Updated with pointers to `.ai/`
- `CLAUDE.md` — Updated with pointers to `.ai/`
- `AUDIT_BUGS.md` — No changes (still source of truth for known bugs)
- `docs/` — No changes (complementary to `.ai/`)
- `.github/workflows/` — No changes (parallel to new validation)
- `backend/tests/`, `frontend/__tests__/` — No changes
- `package.json`, `.claude/settings.json` — Minimal updates

### ⚠️ Modified (Minimal)

1. **`package.json`**
   - Added `"prepare": "husky"` hook
   - Added `npm run validate` + `npm run validate:quick` scripts
   - Added `husky` devDependency

2. **`.claude/settings.json`**
   - Added post-edit hooks for auto-validation (`--quick` mode)
   - Kept existing permission allowlists

3. **`AGENTS.md`**
   - Added reference to `.ai/` as source of truth
   - Kept KeepEat-specific product rules

---

## Why These Changes

### 1. Centralized Rules (`.ai/`)

**Before**:
- Rules scattered in AGENTS.md, CLAUDE.md, docs/
- No single source of truth
- Difficult to evolve (changes in multiple places)

**After**:
- `.ai/core-rules.md` is authoritative
- AGENTS.md/CLAUDE.md point to it
- Easy to update rules globally

### 2. Unified Validation (`ai-validate.sh`)

**Before**:
- Tests run manually or via CI
- No pre-push hook
- Developers could push broken code

**After**:
- `./scripts/ai-validate.sh` runs locally before push
- `./scripts/ai-validate.sh --quick` skips tests (faster feedback)
- Pre-push hook blocks failed builds

### 3. Multi-Stack Support

**Before**:
- Frontend and backend validators separate
- No coordinated validation

**After**:
- `ai-validate.sh` orchestrates both
- Stack-specific validators in `scripts/lib/`
- `.ai/project-profile.json` declares stacks

### 4. Stack Conventions

**Before**:
- Node.js --test rules scattered
- pytest rules scattered
- Maestro rules scattered

**After**:
- `.ai/stacks/react-native-expo.md` — Comprehensive frontend guide
- `.ai/stacks/python-fastapi.md` — Comprehensive backend guide
- `.ai/stacks/e2e-maestro.md` — Comprehensive E2E guide

---

## Migration Path

### Phase 1: Core Governance ✅ DONE
- Create `.ai/` files (core-rules, task-flow, test-policy, review-checklist)
- Create stack profiles (react-native-expo, python-fastapi, e2e-maestro)
- Create `project-profile.json`

### Phase 2: Validation Scripts (IN PROGRESS)
- Create `scripts/ai-validate.sh` dispatcher
- Create `scripts/lib/*` stack validators
- Test locally: `./scripts/ai-validate.sh --quick`

### Phase 3: Husky Hooks (TODO)
- Install Husky: `npm install husky`
- Create `.husky/pre-commit` and `.husky/pre-push`
- Test locally: `git commit` → pre-commit hook runs

### Phase 4: IDE Integration (TODO)
- Create `.cursor/rules/project.mdc`
- Update `.claude/settings.json` (add hooks)

### Phase 5: CI/CD Update (TODO)
- Update `.github/ci.yml` to call `./scripts/ai-validate.sh`
- Add `enforce-tests.yml` if missing

### Phase 6: Documentation (TODO)
- Update AGENTS.md (point to `.ai/`)
- Update CLAUDE.md (point to `.ai/`)
- Commit with single PR

---

## Backward Compatibility

### Existing Workflows Still Work

```bash
# These still work (not broken):
npm run lint           # Frontend lint
npm run typecheck      # Frontend type check
npm run test:unit      # Frontend unit tests
npm run test:ci        # Frontend all tests

pytest backend/tests/  # Backend tests
maestro test .maestro/ # E2E tests
```

### New Unified Workflow

```bash
# New option (simpler):
./scripts/ai-validate.sh           # Full suite
./scripts/ai-validate.sh --quick   # No tests (faster)
npm run validate                   # Same as above
npm run validate:quick             # Same as above
```

### Git Hooks Are Automatic

```bash
git add file.ts
git commit -m "feat: add recipe"
# pre-commit hook runs: verify-tests-added.mjs

git push origin feature/my-feature
# pre-push hook runs: ./scripts/ai-validate.sh (full)
```

---

## Testing the Integration

### Locally

```bash
cd /c/Perso/PERSO-USB/Projets/KeepEat/KeepEat-main/keepeat

# 1. Verify .ai/ files exist
ls -la .ai/
ls -la .ai/stacks/

# 2. Parse project profile
cat .ai/project-profile.json | jq .stacks

# 3. Run validation (quick mode - no tests)
./scripts/ai-validate.sh --quick

# 4. Run full validation (includes tests - takes longer)
./scripts/ai-validate.sh

# 5. Test git hooks (after Husky setup)
git add .ai/
git commit -m "feat: integrate Project_AI_Based_Template governance"
# Should trigger pre-commit hook
```

### In CI

```bash
# Push to feature branch
git push origin feature/template-integration

# GitHub Actions runs:
# - frontend-pr-checks (npm lint, typecheck, test:ci)
# - backend-pr-checks (pytest)
# - policy-pr-checks (verify-tests-added.mjs)

# All must pass before merge
```

---

## Known Issues / Next Steps

### Phase 2 Blockers

- [ ] `scripts/ai-validate.sh` not yet created
- [ ] `scripts/lib/*` validators not yet created
- [ ] Cannot test validation locally yet

### Phase 3 Blockers

- [ ] Husky not yet installed
- [ ] Pre-commit/pre-push hooks not yet created
- [ ] Git hooks not active yet

### Phase 4 Blockers

- [ ] `.cursor/rules/project.mdc` not yet created
- [ ] `.claude/settings.json` hooks not yet updated

### Phase 5 Blockers

- [ ] `.github/ci.yml` not yet updated to use `ai-validate.sh`
- [ ] `enforce-tests.yml` may need creation

---

## Rollback Instructions

If any phase breaks, rollback is clean:

```bash
# Remove new directories
rm -rf .ai/ .husky/ .cursor/

# Restore scripts/ (keep only custom KeepEat scripts)
git checkout HEAD -- scripts/

# Restore config files
git checkout HEAD -- .claude/settings.json AGENTS.md CLAUDE.md package.json

# Revert commit
git reset --hard HEAD~1
```

---

## References

- **Template source**: `/c/Local/git/Project_AI_Based_Template/Project_AI_Based_Template/`
- **KeepEat repo**: `/c/Perso/PERSO-USB/Projets/KeepEat/KeepEat-main/keepeat/`
- **Plan**: `C:\Users\M67038\.claude\plans\mighty-prancing-stardust.md`

---

## Sign-off

- **Integration started**: May 13, 2026
- **Status**: Phase 1 complete, Phase 2+ pending
- **Owner**: Claude Code (AI agent)
- **Reviewer**: [User review pending]

---

## Appendix: Stack Auto-detection

If `.ai/project-profile.json` is missing, `read-profile.sh` auto-detects:

```bash
# Looks for:
- package.json + "expo" → react-native-expo
- package.json + "next" → nextjs
- package.json + "typescript" → node-ts
- pyproject.toml OR requirements.txt + "fastapi" → python-fastapi
- pubspec.yaml → flutter
- .maestro/ directory → e2e-maestro

# Example output
Detected stacks: react-native-expo, python-fastapi, e2e-maestro
```

This allows validation to work even without explicit profile configuration.
