# Stack Profile: Maestro E2E Testing

> KeepEat end-to-end testing conventions with Maestro.

## Quick Facts

- **Framework**: Maestro (mobile automation)
- **Tests Location**: `.maestro/` directory
- **Target**: Both Android and iOS (Expo)
- **Speed**: Slow (5-60 minutes depending on suite)
- **CI Integration**: Separate `mobile-e2e.yml` workflow

---

## Running Tests

### Locally

```bash
# Build app for testing
npm run build:e2e

# Run all Maestro tests
maestro test .maestro/

# Run specific test file
maestro test .maestro/smoke.yaml

# Run on specific device/emulator
maestro test .maestro/ --device emulator-pixel-5
maestro test .maestro/ --device iphone-14-pro

# With verbose output
maestro test .maestro/ --verbose
```

### In CI

```bash
# GitHub Actions runs nightly (via mobile-e2e-nightly.yml)
# Or triggered manually (via mobile-e2e.yml)
```

---

## Test Organization

```
.maestro/
├── smoke.yaml               # Critical paths only (~2 min)
├── recipes.yaml             # Recipe feature flows (~5 min)
├── stock.yaml               # Stock/expiration flows (~5 min)
├── auth.yaml                # Authentication flows (~3 min)
├── config.yaml              # Settings & preferences (~2 min)
├── regressions.yaml         # Known bug scenarios (~5 min)
├── nightly.yaml             # Extended suite (runs nightly)
└── [shared fixtures if needed]
```

---

## Test Suites

### Smoke Tests (Critical Paths)

**Purpose**: Verify app boots and core flows work
**Speed**: ~2 minutes
**Runs**: Every PR, every push

```yaml
appId: com.keepeat.app

tests:
  - testID: app-boots
    steps:
      - launchApp

  - testID: login-recipe-logout
    steps:
      - tap:
          id: login-button
      - input:
          id: email-field
          text: "test@example.com"
      - input:
          id: password-field
          text: "password123"
      - tap:
          id: login-confirm-button
      - assert:
          - text: "My Recipes"
      - tap:
          id: recipe-add-button
      - input:
          id: recipe-name
          text: "Pasta"
      - tap:
          id: recipe-save-button
      - assert:
          - text: "Pasta"
      - tap:
          id: logout-button
      - assert:
          - text: "Login"
```

### Regression Tests

**Purpose**: Verify previously-broken bugs are fixed
**Speed**: ~5 minutes
**Runs**: Every PR

```yaml
appId: com.keepeat.app

tests:
  - testID: recipe-expires-correctly
    # Bug: Recipe showed as fresh after expiration date
    steps:
      - launchApp
      - tap:
          id: login-button
      - input:
          id: email-field
          text: "test@example.com"
      - input:
          id: password-field
          text: "password123"
      - tap:
          id: login-confirm-button
      - tap:
          id: stock-tab
      - assert:
          # Recipe added 30 days ago with 30-day shelf life should show as expired
          - text: "Expired"
```

### Feature-Specific Tests

Target one feature per file (recipes, stock, auth, config, etc.)

---

## testID Convention

**All interactive elements must have `testID`** for Maestro to locate them.

### Frontend (React Native) - Required Setup

```typescript
// ✓ Good - Maestro can find it
<Button 
  testID="recipe-add-button"
  onPress={handleAdd}
  title="Add Recipe"
/>

<TextInput
  testID="ingredient-search"
  placeholder="Search..."
  value={searchTerm}
  onChangeText={setSearchTerm}
/>

<FlatList
  testID="recipe-list"
  data={recipes}
  renderItem={({ item }) => (
    <Pressable testID={`recipe-item-${item.id}`}>
      <Text>{item.name}</Text>
    </Pressable>
  )}
/>

// ✓ Screen containers should also have testID
<View testID="recipes-screen">
  {/* ... */}
</View>

// ✗ Bad - Maestro can't find it
<Pressable onPress={handleAdd}>
  <Text>Add</Text>
</Pressable>
```

### Naming Pattern

- `<feature>-<action>-button` → `recipe-add-button`, `stock-edit-button`
- `<feature>-<element>` → `ingredient-search`, `recipe-list`
- `<feature>-item-<id>` → `recipe-item-123`, `stock-item-pasta`
- `<feature>-screen` → `recipes-screen`, `auth-screen`

---

## Writing Maestro Tests

### Basic Structure

```yaml
appId: com.keepeat.app  # Package ID for Android

tests:
  - testID: unique-test-name
    steps:
      # Setup
      - launchApp
      
      # Actions
      - tap:
          id: button-id
      - input:
          id: field-id
          text: "user input"
      - scroll:
          direction: down
      
      # Assertions
      - assert:
          - text: "Expected text"
          - visible:
              id: element-id
```

### Common Actions

```yaml
steps:
  # Navigation
  - launchApp
  - back
  - tapDeviceBackButton

  # Input
  - tap:
      id: button-id
  - input:
      id: field-id
      text: "text to enter"
  - clearInput:
      id: field-id

  # Scrolling
  - scroll:
      direction: down
      amount: 5

  # Assertions
  - assert:
      - text: "Text to find"
      - visible:
          id: element-id
      - notVisible:
          id: hidden-id

  # Waits
  - wait:
      length: 2000  # ms

  # Screenshots
  - screenshot:
      name: "state-before-action"
```

### Conditional Logic

```yaml
steps:
  - repeat:
      times: 3
      steps:
        - scroll:
            direction: down
            amount: 2
        - runScript:
            file: check_for_expired.yaml

  - runScript:
      file: shared-login.yaml
```

### Shared Fixtures

```yaml
# .maestro/shared-login.yaml
steps:
  - tap:
      id: login-button
  - input:
      id: email-field
      text: "test@example.com"
  - input:
      id: password-field
      text: "password123"
  - tap:
      id: login-confirm-button
```

Usage in test:

```yaml
tests:
  - testID: stock-flow
    steps:
      - launchApp
      - runScript:
          file: shared-login.yaml
      - tap:
          id: stock-tab
      # Continue test...
```

---

## Test Data Management

### Using Seed Data

Before E2E tests run, reset database with known state:

```bash
# Reset test DB and seed data
npm run e2e:reset-seed

# Defined in: scripts/e2e-reset-seed.mjs
```

### Backend Test Mode

Backend must support test mode (see `backend/test_mode.py`):

```python
# Backend: Enable test mode fixture
@app.get("/api/test/reset")
async def reset_test_data():
    """Reset database to known state for E2E testing."""
    # Clear all data
    # Seed default recipes, users, etc.
    return {"status": "reset"}
```

### Static Test Accounts

Use fixed test accounts (same for all runs):

```yaml
tests:
  - testID: login-flow
    steps:
      - launchApp
      - tap:
          id: login-button
      - input:
          id: email-field
          text: "e2e-test@example.com"  # Fixed account
      - input:
          id: password-field
          text: "e2e-test-password"     # Known password
      - tap:
          id: login-confirm-button
      - assert:
          - text: "My Recipes"
```

---

## CI Integration

### GitHub Actions

**File**: `.github/workflows/mobile-e2e.yml`

```bash
# Runs on:
# - PR labeled "e2e"
# - Manual trigger via workflow_dispatch

# Steps:
# 1. Checkout code
# 2. Setup Node + Python
# 3. npm ci + npm run build:e2e
# 4. pip install -r requirements.txt
# 5. npm run e2e:reset-seed
# 6. maestro test .maestro/smoke.yaml
# 7. (Optional) maestro test .maestro/ (full suite)
```

**Nightly Run**:

```bash
# File: `.github/workflows/mobile-e2e-nightly.yml`
# Runs: Daily at 2 AM UTC
# Runs: Full suite + extended tests
# Timeout: 60 minutes
```

---

## Debugging E2E Tests

### On Emulator

```bash
# Keep emulator open for debugging
maestro test .maestro/smoke.yaml --interactive

# Check logcat
npm run capture-logcat

# Take screenshots during test
# (see: maestro/smoke.yaml - screenshot steps)
```

### Verbose Output

```bash
maestro test .maestro/ --verbose
# Shows every step, every assertion
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Element not found | Check `testID` spelling, ensure element is visible |
| Timeout waiting for element | Add `wait` step before `assert` |
| Race condition (element appears late) | Increase wait time or add retry logic |
| Test passes locally, fails in CI | Check seed data reset, time zones, network |
| App crashes mid-test | Check backend logs, run backend in test mode |

---

## Best Practices

1. **One feature per file**
   - `recipes.yaml` tests recipe flows only
   - `stock.yaml` tests inventory flows only
   - Easier to debug, faster to run

2. **Use shared fixtures for common actions**
   - Login, logout, app reset
   - Reduces duplication

3. **Test from user perspective**
   - "Add recipe" not "POST /api/recipes"
   - "Scroll down" not "JavaScript scrollTo"

4. **Seed data must be consistent**
   - Run `e2e:reset-seed` before each test
   - Same test data every run

5. **Assertions over waits**
   - Assert what you expect to see
   - Don't just wait 5 seconds (flaky)

6. **Take screenshots for debugging**
   - `screenshot:` step shows state at each point
   - Helps debug failures in CI

---

## References

- [Maestro documentation](https://maestro.mobile.dev/)
- [Maestro YAML syntax](https://maestro.mobile.dev/api-reference/commands)
- [Expo testing guide](https://docs.expo.dev/build-reference/e2e-tests/)
- [KeepEat Maestro scripts](.maestro/) — See actual examples
