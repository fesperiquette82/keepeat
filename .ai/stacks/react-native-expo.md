# Stack Profile: React Native + Expo (Frontend)

> KeepEat frontend stack rules and conventions.

## Quick Facts

- **Framework**: React Native with Expo
- **Language**: TypeScript (strict mode)
- **Test Framework**: Node.js `--test` (NOT Jest)
- **Linter**: ESLint (flat config)
- **E2E**: Maestro
- **Package Manager**: npm

---

## Development Setup

```bash
# Install dependencies
npm ci

# Run locally
npm start        # Starts Expo dev server
npm run android  # Run on Android emulator/device

# Build
npm run build:e2e   # Build for Maestro testing
npm run build       # Production build
```

---

## Testing Commands

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Smoke tests (critical paths)
npm run test:smoke

# All three
npm run test:ci

# Watch mode (during development)
npm run test:watch
```

---

## Code Conventions

### TypeScript Strictness

- Strict mode: `tsconfig.json` enforces strict type checking
- **NO** `any` types without comment
- **NO** `type: ignore` without comment + issue reference
- Use discriminated unions over type guards when possible

```typescript
// ✓ Good
type Result = 
  | { status: 'success'; data: Recipe[] }
  | { status: 'error'; error: Error };

// ✗ Bad
type Result = { status: string; data?: Recipe[]; error?: Error };
```

### Component Structure

```typescript
// ✓ Good - reusable, testable
const RecipeCard: FC<{ recipe: Recipe; onPress: () => void }> = ({
  recipe,
  onPress,
}) => (
  <Pressable testID="recipe-card" onPress={onPress}>
    <Text>{recipe.name}</Text>
  </Pressable>
);

// ✗ Bad - one-off, hard to test
const Dashboard = () => (
  <FlatList data={recipes} renderItem={({ item }) => (
    <View>
      <Text>{item.name}</Text>
    </View>
  )} />
);
```

### Hooks & Custom Logic

- Extract custom hooks from components (max 50 lines per component)
- Use `useCallback` for callbacks passed to child components
- Prefer `useReducer` for complex state (not Redux for simple cases)
- Always specify dependency arrays (`[] ` or `[dep1, dep2]`)

```typescript
// ✓ Extract custom hook
const useRecipeFiltering = (recipes: Recipe[], filters: Filters) => {
  return useMemo(
    () => recipes.filter(r => matchesFilters(r, filters)),
    [recipes, filters]
  );
};

const RecipeList = () => {
  const filtered = useRecipeFiltering(recipes, filters);
  // ...
};
```

### No console.log in Production

- ❌ Never ship `console.log` to users
- ✅ Use debug config: `DEBUG=keepeat:*` for development
- ✅ Log errors cleanly: `console.error()` with context

```typescript
// ✗ Bad
const handleRecipeAdd = (recipe) => {
  console.log('Adding recipe:', recipe);  // ❌ Remove before commit
  addRecipe(recipe);
};

// ✓ Good
const handleRecipeAdd = (recipe) => {
  if (DEBUG_MODE) {
    console.debug('[RecipeAdd]', recipe);
  }
  addRecipe(recipe);
};
```

---

## File Structure

```
frontend/
├── app/                         # App routing (Expo Router)
│   ├── _layout.tsx              # Root layout
│   ├── (tabs)/                  # Tab navigation
│   │   ├── recipes.tsx
│   │   ├── stock.tsx
│   │   └── settings.tsx
│   └── [id].tsx                 # Dynamic routes
├── components/                  # Reusable components
│   ├── RecipeCard.tsx
│   ├── ShoppingListItem.tsx
│   └── [...]
├── hooks/                       # Custom hooks
│   ├── useRecipeFiltering.ts
│   ├── useStockExpiration.ts
│   └── [...]
├── utils/                       # Utilities & helpers
│   ├── dateHelpers.ts
│   ├── ingredientMatching.ts
│   └── [...]
├── store/                       # State management
│   ├── recipeStore.ts
│   ├── stockStore.ts
│   └── [...]
├── data/                        # Constants & data
│   └── mockData.ts
├── __tests__/                   # Unit + integration tests
├── integration/                 # Integration tests
├── smoke/                       # Smoke tests (critical paths)
└── assets/                      # Images, fonts, etc.
```

---

## Testing Patterns

### Unit Test Template

```typescript
import test from 'node:test';
import assert from 'node:assert';
import { filterRecipesByIngredient } from '../utils/ingredientMatching';

test('returns recipes containing specified ingredient', () => {
  // Arrange
  const recipes = [
    { name: 'Pasta', ingredients: ['pasta', 'tomato'] },
    { name: 'Salad', ingredients: ['lettuce', 'olive oil'] },
  ];

  // Act
  const result = filterRecipesByIngredient(recipes, 'tomato');

  // Assert
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'Pasta');
});
```

### Integration Test Template

```typescript
import test from 'node:test';
import assert from 'node:assert';
import { renderWithProviders } from '../test-utils';
import { RecipeList } from '../components/RecipeList';

test('displays recipes from store', () => {
  // Arrange
  const { getByText } = renderWithProviders(<RecipeList />);

  // Act
  const recipeTitle = getByText('Pasta Carbonara');

  // Assert
  assert.ok(recipeTitle);
});
```

### Mocking Strategy

```typescript
// ✓ OK: Mock API calls
import { vi } from 'vitest'; // If using Vitest
vi.mock('../api/recipes', () => ({
  fetchRecipes: vi.fn(() => Promise.resolve(mockRecipes)),
}));

// ✗ DON'T: Mock business logic
// Don't mock: filterRecipesByIngredient, calculateExpiration, etc.

// ✓ OK: Mock time-dependent code
vi.useFakeTimers();
vi.setSystemTime(new Date('2026-05-15'));
```

---

## Linting & Formatting

```bash
# Check ESLint
npm run lint

# Format with Prettier
npm run format

# Type check
npm run typecheck

# All together
npm run validate:quick
```

**ESLint rules** (See `.eslintrc.js`):
- No unused variables
- No console in production (except console.error)
- No missing dependencies in hooks
- Accessibility checks

---

## Maestro E2E Integration

### testID Convention

All interactive elements MUST have `testID` for Maestro to locate them:

```typescript
<Button 
  testID="recipe-add-button"
  onPress={handleAdd}
  title="Add Recipe"
/>

<TextInput
  testID="ingredient-search"
  placeholder="Search ingredients..."
  value={searchTerm}
  onChangeText={setSearchTerm}
/>

<FlatList
  testID="recipe-list"
  data={recipes}
  renderItem={({ item }) => (
    <Pressable testID={`recipe-item-${item.id}`}>
      {/* ... */}
    </Pressable>
  )}
/>
```

### Running E2E Tests

```bash
# Build app for testing
npm run build:e2e

# Run smoke tests
maestro test .maestro/smoke.yaml

# Run all E2E tests
maestro test .maestro/
```

---

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Component re-renders unnecessarily | Use `useMemo`, `useCallback`, memo() |
| Tests fail on real device but pass in emulator | Test on both Android and iOS |
| Async issues in tests | Ensure promises resolve, use async/await |
| Large bundle size | Code-split routes, lazy-load components |
| Memory leaks | Cleanup in useEffect return function |
| Race conditions | Use proper key prop in lists |

---

## Accessibility

- Use `testID` on all interactive elements (also helps Maestro)
- Use semantic components (`Button`, not `Pressable` for buttons)
- Ensure color contrast meets WCAG AA
- Add `accessibilityLabel` for screen readers when needed

---

## Performance

- Use `FlatList` with `maxToRenderPerBatch` for large lists
- Profile with React DevTools Profiler
- Lazy-load images with placeholder
- Avoid re-rendering entire list on single item change

---

## Debugging

```bash
# Enable debug logging
DEBUG=keepeat:* npm start

# Inspect network requests
# Use Flipper (included with Expo)

# Check console errors
# Open Expo debugger in browser
```

---

## References

- [React Native docs](https://reactnative.dev)
- [Expo documentation](https://docs.expo.dev)
- [Node.js test runner](https://nodejs.org/api/test.html)
- [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files-new)
