# User-Visible Bug Coverage Rule (Rule 1.6)

> **Enforcement**: Activated 2026-05-22  
> **Script**: `scripts/validate-user-visible-bug-coverage.mjs`  
> **Hook**: `.husky/commit-msg` (warns for missing coverage)

---

## What is a "User-Visible Bug"?

A bug is **user-visible** if the user perceives incorrect behavior:

### ✅ User-Visible Examples
- Swipe action does opposite thing (Stock item)
- Recipe expires but still shows as fresh
- API returns 401 but app doesn't handle it
- OCR result missing in UI
- Button click does nothing

### ❌ NOT User-Visible Examples
- Internal utility function broken
- Type system error (TypeScript)
- Build process issue
- Database query optimization
- Internal API contract broken (if user-facing API still works)

---

## The 3-Level Coverage Requirement

**For each user-visible bug fix, provide tests at ALL 3 levels:**

| Level | Focus | Example Files | Why |
|-------|-------|----------------|-----|
| **1. Unit** | Smallest logic | `frontend/__tests__/utils/` or `backend/tests/test_*.py` | Catch logic errors early, fast feedback |
| **2. Integration** | Data boundary | `frontend/integration/` or `backend/tests/test_*_contract.py` | Verify data flows correctly through layers |
| **3. UI/E2E** | Visible behavior | `frontend/smoke/` or `.maestro/*.yaml` | Confirm user actually sees the fix |

---

## Case Study: BUG-021 (Swipe Actions Inversed)

**Bug**: Swipe left shows "Utilisé" but marks item as "Jeté" (opposite)

### Analysis
- **Visible to user?** ✅ YES — User sees wrong action
- **User impact?** 🔴 CRITICAL — Stock corrupted

### Required Coverage

#### Level 1: Unit Test
```typescript
// frontend/__tests__/utils/swipeHandling.test.ts
test('direction left means left panel opened (swipe right)', () => {
  const result = mapDirectionToAction('left');
  assert.equal(result, 'used');  // Left panel = "Utilisé"
});

test('direction right means right panel opened (swipe left)', () => {
  const result = mapDirectionToAction('right');
  assert.equal(result, 'thrown');  // Right panel = "Jeté"
});
```

**What it tests**: Direction → Action mapping (pure function)
**Why needed**: Catches the logic bug immediately

---

#### Level 2: Integration Test
```typescript
// frontend/integration/stockSwipeActions.integration.test.ts
test('swiping left marks stock item as used', async () => {
  const { getByTestId } = renderWithProviders(<StockList />);
  
  // Act: Simulate swipe left
  const stockItem = getByTestId('stock-item-pasta');
  fireEvent.swipeableOpen(stockItem, 'left');  // User swipes left
  
  // Assert: Item marked as used (state updated)
  const state = store.getState();
  assert.equal(state.stock[0].status, 'used');
});

test('swiping right marks stock item as thrown', async () => {
  // Similar test for swipe right → 'thrown'
});
```

**What it tests**: Component state + handler interaction
**Why needed**: Ensures data flows correctly from UI to state

---

#### Level 3: UI/E2E Test
```yaml
# .maestro/stock-swipe-regression.yaml
appId: com.keepeat.app

tests:
  - testID: swipe-left-marks-used
    steps:
      - launchApp
      - runScript:
          file: shared-login.yaml
      - tap:
          id: stock-tab
      - swipe:
          id: stock-item-pasta
          direction: left
      - assert:
          - text: "Utilisé"  # Confirms visible feedback
      - scroll:
          direction: down
      - assert:
          - notVisible:
              id: stock-item-pasta  # Item removed from list (marked used)
  
  - testID: swipe-right-marks-thrown
    steps:
      - launchApp
      - runScript:
          file: shared-login.yaml
      - tap:
          id: stock-tab
      - swipe:
          id: stock-item-milk
          direction: right
      - assert:
          - text: "Jeté"  # Confirms visible feedback
```

**What it tests**: Real gesture + visual result on screen
**Why needed**: Proves user actually sees the fix

---

## How to Identify Test Levels

### Unit Test Indicators
- Tests a pure function or hook
- No component rendering
- No API calls (all mocked)
- Fast (< 100ms)
- File: `__tests__/utils/*.test.ts` or `backend/tests/test_*.py`

### Integration Test Indicators
- Tests component + state interaction
- Uses rendered components
- May call mocked APIs
- Moderate speed (100-500ms)
- File: `integration/*.test.ts` or `backend/tests/test_*_contract.py`

### UI/E2E Test Indicators
- Tests full user flow
- Real gestures (tap, swipe, scroll)
- Real API (or seeded data)
- Slow (5-30s)
- File: `smoke/*.test.ts` or `.maestro/*.yaml`

---

## When a Level is Impossible

**Document why in the commit message:**

```bash
git commit -m "fix(auth): handle 401 gracefully

Regression tests:
- Unit: handleAuthError() returns correct state ✅
- Integration: Redux dispatch triggers logout ✅
- E2E: Cannot test without real auth server ⚠️
  → Tested locally with mock server, CI uses service account

Reason: E2E requires external auth service (Cognito, Firebase)
Solution: Local dev uses mock, CI uses test service account
"
```

---

## Enforcement

### How It Works
1. **Commit message validation**: `.husky/commit-msg` hook
2. **Triggers on**: Any commit starting with `fix`
3. **Checks**:
   - Is it user-visible? (heuristic: frontend or API changes)
   - Do test files exist at all 3 levels?
4. **Result**:
   - ✅ All 3 levels present → ✅ Pass silently
   - ⚠️ Missing levels → ⚠️ Warning printed (not blocking)
   - ❌ No tests at all → ⚠️ Strong warning

### Example Warnings

**Scenario**: Fix frontend bug but only unit test
```
⚠️  Missing test levels for user-visible bug: integration, UI/E2E

Test files detected:
  • frontend/__tests__/utils/expiration.test.ts

Guidance:
  • Add integration test (frontend/integration/ or backend/tests/)
  • Add UI/E2E test (frontend/smoke/ or .maestro/)
```

**Scenario**: Fix backend API but no contract test
```
⚠️  User-visible bug fix detected without test files

For user-visible bugs, provide tests at 3 levels:
  1️⃣  Unit test — smallest logic (function, hook, utility)
  2️⃣  Integration test — data boundary (component interaction, API contract)
  3️⃣  UI/E2E test — visible behavior (Maestro, screen state)
```

---

## When to Override

**Skip 3-level coverage if**:
- Bug is **not** user-visible (e.g., internal utility)
- Testing a level is **genuinely impossible** (explain why in commit)
- Fix is **emergency hotfix** (document temporary; add tests in followup)

**Example valid override**:
```
fix(perf): optimize recipe list rendering (memo())

Regression tests:
- Unit: memoized component skips re-renders ✅
- Integration: list performance improved ✅
- E2E: Not applicable — performance testing requires profiler

Justification: Can't measure perf in Maestro (no profiler support)
Validation: Measured locally with React Profiler (10ms → 2ms)
```

---

## Checklist for Bug Fixes

Before committing a user-visible bug fix:

- [ ] **Unit test**: Pure logic works correctly
- [ ] **Integration test**: Data flows through layers
- [ ] **UI/E2E test**: User sees the fix on screen
- [ ] **OR document**: Why a level is impossible
- [ ] **Commit message**: `fix(scope): description`
- [ ] **AUDIT_BUGS.md**: Updated with test details & status

---

## Related Rules

- **Rule 1.1**: Every bug fix → regression test
- **Rule 1.2**: Every feature → acceptance test
- **Rule 1.6** (this): User-visible bugs → 3-level coverage
- **Test policy**: `.ai/test-policy.md` (architecture)
- **Coverage map**: `.ai/coverage-map.md` (domain coverage tracker)

---

## FAQ

### Q: What if the bug is in both frontend and backend?
**A**: Cover both stacks:
- Frontend unit + integration + UI
- Backend unit + integration (contract test)

### Q: Can integration and E2E tests be the same file?
**A**: No, test 2 and 3 are different purposes:
- Integration: Data flow, state changes
- E2E: User-visible result (what they see on screen)

### Q: What about flaky E2E tests?
**A**: Still required, but:
- Mark as `@flaky` and document why
- Add retry logic
- Add explicit waits for async operations
- Don't skip without investigation

### Q: 3 levels seems excessive. Can I skip?
**A**: Only if:
1. Bug is NOT user-visible, OR
2. Level is genuinely impossible (with explanation)

Otherwise, 3 levels ensure the fix is correct at every layer.

---

**Script enforcement**: `scripts/validate-user-visible-bug-coverage.mjs`  
**Hook trigger**: `.husky/commit-msg` on `fix` commits  
**Documentation**: This file  
**Status**: ✅ Enforced since 2026-05-22
