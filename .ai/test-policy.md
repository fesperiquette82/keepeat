# Test Policy — Testing Standards for KeepEat

> Defines test architecture, placement, and conventions for both frontend and backend.

## Test Pyramid

```
        /\
       /E2E\       Maestro integration tests
      /------\     (slow, expensive, real device)
     /        \
    /Integration\  Full feature flows, multiple services
   /----------\
  /            \
 /Unit Tests   \  Individual functions, components, services
/______________\ (fast, many, cheap)
```

**Principle**: Many unit tests (cheap), fewer integration tests, fewest E2E tests.

---

## Frontend Testing (React Native Expo)

### Test Framework: Node.js `--test` (NOT Jest)

KeepEat frontend uses native Node.js `--test` framework. Jest configuration exists but is **unused**.

### Test Structure

```
frontend/
├── __tests__/
│   ├── utils/
│   │   ├── dateHelpers.test.ts
│   │   ├── recipeFiltering.test.ts
│   │   └── ingredientMatching.test.ts
│   ├── components/
│   │   ├── RecipeCard.test.ts
│   │   ├── ShoppingList.test.ts
│   │   └── ...
│   └── screens/
│       ├── NavigationFlow.test.ts
│       └── ...
├── integration/
│   ├── recipesPresentation.integration.test.ts
│   ├── stockManagement.integration.test.ts
│   └── ...
├── smoke/
│   ├── appBootstrap.smoke.test.ts
│   ├── criticalPath.smoke.test.ts
│   └── ...
└── [source files: app/, utils/, store/, components/]
```

### Test Suites

| Suite | Command | Purpose | Scope |
|-------|---------|---------|-------|
| **Unit** | `npm run test:unit` | Individual functions, hooks, utilities | `__tests__/utils/`, co-located `.test.ts` |
| **Integration** | `npm run test:integration` | Multi-component flows, state management | `frontend/integration/` |
| **Smoke** | `npm run test:smoke` | Critical paths, app bootstrap | `frontend/smoke/` |
| **CI** | `npm run test:ci` | All three (unit + integration + smoke) | All suites |

### Writing Tests

1. **Test names are behavior descriptions**
   ```typescript
   // ✓ Good
   test('returns filtered recipes when ingredient is missing from stock', () => {})
   
   // ✗ Bad
   test('filters', () => {})
   test('recipe-filter-function', () => {})
   ```

2. **Arrange-Act-Assert (AAA) pattern**
   ```typescript
   test('calculates expiration correctly', () => {
     // Arrange
     const item = { purchaseDate: '2026-05-01', shelfLife: 30 };
     
     // Act
     const expirationDate = calculateExpiration(item);
     
     // Assert
     assert.equal(expirationDate, '2026-05-31');
   });
   ```

3. **No snapshots** (React Native Testing Library doesn't recommend)
   - ❌ `expect(render()).toMatchSnapshot()`
   - ✅ Assert on specific properties: `expect(screen.getByText('Recipe')).toBeTruthy()`

4. **Mock strategy**
   ```typescript
   // ✓ OK to mock: Network
   vi.mock('./api', () => ({
     fetchRecipes: vi.fn(() => Promise.resolve([...]))
   }));
   
   // ✗ DON'T mock: Business logic
   // ✗ DON'T mock: Data transformations you're testing
   // ✗ DON'T mock: State management unless testing integration point
   ```

### Accessibility Labels (Maestro-compatible)

All interactive elements must have `testID` for E2E testing:
```typescript
<Button testID="recipe-add-button" onPress={handleAdd} />
<TextInput testID="ingredient-search" placeholder="Search..." />
```

---

## Backend Testing (FastAPI + pytest)

### Test Framework: pytest

### Test Structure

```
backend/
├── tests/
│   ├── conftest.py                              # Shared fixtures
│   ├── test_critical_bug_regressions.py         # 19 KB - Bug fix validation
│   ├── test_recipe_suggestions_contract.py      # API contract tests
│   ├── test_admin_monitoring_dashboard_api.py   # Admin endpoints
│   ├── test_ocr_service.py                      # OCR integration
│   ├── test_recipe_gap_upsert.py                # Catalog operations
│   ├── test_service_limits.py                   # Rate limiting
│   ├── test_backend_package_imports.py          # Import smoke test
│   └── [... 10+ more test suites]
├── [source files: app_core.py, alerts.py, ocr_service.py, etc.]
└── models.py, server.py, etc.
```

### Running Tests

```bash
# All tests
pytest backend/tests/

# Specific test file
pytest backend/tests/test_critical_bug_regressions.py

# Specific test function
pytest backend/tests/test_critical_bug_regressions.py::test_expiration_calculation

# With verbose output
pytest -v backend/tests/

# With coverage
pytest --cov=backend backend/tests/

# CI priority suites (faster feedback)
pytest \
  backend/tests/test_ci_non_regression_policy.py \
  backend/tests/test_critical_regressions.py \
  backend/tests/test_recipe_suggestions_contract.py
```

### Test Fixtures (conftest.py)

```python
# Example: Shared database session
@pytest.fixture
def db_session():
    """Provides clean test database session"""
    session = get_test_session()
    yield session
    session.close()

# Usage in test
def test_recipe_upsert(db_session):
    recipe = models.Recipe(name="Pasta")
    db_session.add(recipe)
    db_session.commit()
    assert recipe.id is not None
```

### Writing Tests

1. **Test names describe behavior**
   ```python
   # ✓ Good
   def test_returns_suggested_recipes_when_ingredients_available():
       pass
   
   # ✗ Bad
   def test_recipe():
       pass
   ```

2. **Arrange-Act-Assert pattern**
   ```python
   def test_calculates_monthly_spend(db_session):
       # Arrange
       transaction = models.Transaction(
           amount=15.50, 
           date=datetime(2026, 5, 1)
       )
       db_session.add(transaction)
       db_session.commit()
       
       # Act
       monthly_spend = calculate_monthly_spend(month=5, year=2026)
       
       # Assert
       assert monthly_spend == 15.50
   ```

3. **Use httpx.AsyncClient for API testing** (NOT TestClient)
   ```python
   # ✓ Good - tests actual async behavior
   async def test_get_recipes():
       async with httpx.AsyncClient(app=app) as client:
           response = await client.get("/recipes")
           assert response.status_code == 200
   
   # ✗ Avoid - doesn't test real async
   # client = TestClient(app)
   ```

4. **Mock strategy**
   ```python
   # ✓ OK to mock: External API (OCR)
   @patch('backend.ocr_service.call_ocr_api')
   def test_ocr_fallback(mock_ocr):
       mock_ocr.side_effect = Exception("API down")
       result = process_receipt()
       assert result.status == "fallback_recipe"
   
   # ✗ DON'T mock: FastAPI routes, models, business logic
   # ✗ DON'T mock: Database queries (use test DB instead)
   ```

### Type Checking (mypy)

```bash
# Check types
mypy backend/

# With strict mode
mypy --strict backend/
```

All backend code must pass `mypy` (no `type: ignore` except with comment).

---

## E2E Testing (Maestro)

### Framework: Maestro

Maestro scripts live in `.maestro/` directory.

### Test Types

| Type | File | Purpose | Speed |
|------|------|---------|-------|
| **Smoke** | `.maestro/smoke.yaml` | Critical path (login → recipe → exit) | ~2 min |
| **Feature** | `.maestro/recipes.yaml`, `.maestro/stock.yaml` | Full feature flows | ~5-10 min |
| **Regression** | `.maestro/regressions.yaml` | Known bug scenarios | ~3-5 min |
| **Nightly** | CI trigger | Extended suite, slow devices | ~30-60 min |

### Running Locally

```bash
# Build app for testing
npm run build:e2e  # or expo prebuild

# Run smoke tests
maestro test .maestro/smoke.yaml

# Run all tests
maestro test .maestro/

# On specific device
maestro test .maestro/ --device emulator-pixel-5
```

### Writing Maestro Tests

1. **BDD-style structure**
   ```yaml
   appId: com.keepeat.app
   
   tests:
     - testID: recipe-flow
       steps:
         - tap:
             id: recipe-add-button
         - input:
             text: "Pasta Carbonara"
         - tap:
             id: recipe-save-button
         - assert:
             - text: "Pasta Carbonara"
   ```

2. **Use testID consistently**
   - Must match frontend `testID` prop
   - Declare in React components for Maestro to find

3. **Mock external services**
   - OCR: Use test mode (see backend test_mode.py)
   - API: Use local backend in CI (no external calls)
   - Time: Use fixed dates in test data

---

## Non-Regression Test Policy

### When to Write Regression Tests

1. **Critical paths** (expiration, ingredient matching, spending tracking)
2. **Previously-broken features** (see AUDIT_BUGS.md)
3. **Cross-stack interactions** (frontend + backend + database)
4. **Edge cases** (empty lists, null values, Unicode, etc.)

### Regression Test Locations

- **Frontend logic**: `frontend/__tests__/utils/` (e.g., `dateHelpers.test.ts`)
- **Backend logic**: `backend/tests/test_critical_bug_regressions.py`
- **E2E regression**: `.maestro/regressions.yaml`

### Example Regression Test (Bug: Recipes not expiring)

```typescript
// frontend/__tests__/utils/expiration.test.ts
test('recipe expires after shelf life elapses', () => {
  // Arrange: Today is May 15, 2026
  vi.setSystemTime(new Date('2026-05-15'));
  const recipe = {
    purchaseDate: '2026-04-15',  // 30 days ago
    shelfLife: 30,
  };
  
  // Act
  const isExpired = checkExpiration(recipe);
  
  // Assert
  assert.equal(isExpired, true);
});
```

---

## Coverage & Metrics

- **Frontend**: Target 70%+ coverage (not 100% - quality > quantity)
- **Backend**: Target 80%+ coverage (business logic critical)
- **Flaky tests**: Never merge (investigate root cause, fix or skip)
- **Skipped tests**: Document why with comment + issue number

---

## Absolute Rules

1. ✓ **Always** write tests for behavior
2. ✓ **Always** place tests in appropriate suite
3. ✓ **Always** verify tests fail first (red phase)
4. ✓ **Always** use realistic data (not mocks) when possible
5. ✗ **Never** mock the logic being tested
6. ✗ **Never** commit broken tests
7. ✗ **Never** skip tests to make CI pass
8. ✗ **Never** reduce coverage thresholds to hide gaps
