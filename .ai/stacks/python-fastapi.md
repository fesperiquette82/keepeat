# Stack Profile: Python + FastAPI (Backend)

> KeepEat backend stack rules and conventions.

## Quick Facts

- **Framework**: FastAPI (async)
- **Language**: Python 3.12
- **ORM**: SQLAlchemy (implied from models.py)
- **Database**: MongoDB (test: local, prod: cloud)
- **Testing**: pytest
- **Type Checking**: mypy (strict mode)
- **Linting**: ruff (check) + black (format)

---

## Development Setup

```bash
# Create virtual environment
python3 -m venv .venv

# Activate
source .venv/bin/activate  # Linux/Mac
# or
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt

# Run dev server
python serve.py            # Or: uvicorn server:app --reload

# Run on specific port
uvicorn server:app --reload --port 8001
```

---

## Testing Commands

```bash
# All tests
pytest backend/tests/

# Priority suites (CI speed)
pytest \
  backend/tests/test_critical_bug_regressions.py \
  backend/tests/test_recipe_suggestions_contract.py \
  backend/tests/test_recipe_gap_upsert.py

# Specific test file
pytest backend/tests/test_recipes_service.py

# Specific test function
pytest backend/tests/test_recipes_service.py::test_upsert_new_recipe

# With coverage
pytest --cov=backend backend/tests/

# Watch mode
pytest-watch backend/tests/

# Verbose output
pytest -v backend/tests/
```

---

## Code Conventions

### Type Hints (mypy strict)

- **ALL** functions must have type hints
- **NO** `type: ignore` without comment
- Use `Optional[T]` instead of `T | None` for compatibility

```python
# ✓ Good
from typing import Optional, List

def get_recipes(category: Optional[str] = None) -> List[Recipe]:
    """Returns recipes, optionally filtered by category."""
    # ...

async def fetch_ocr_result(receipt_id: str) -> dict[str, Any]:
    """Fetch OCR processing result from external service."""
    # ...

# ✗ Bad
def get_recipes(category=None):  # ❌ No type hints
    pass

def process(x: Any) -> Any:  # ❌ Useless types
    pass
```

### Pydantic v2 Models

- Use `BaseModel` for input/output validation
- Define `model_config` for serialization
- Use validators sparingly (prefer type hints)

```python
# ✓ Good
from pydantic import BaseModel, Field

class RecipeInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    ingredients: List[str] = Field(default_factory=list)
    category: Optional[str] = None

    model_config = ConfigDict(str_strip_whitespace=True)

# ✗ Bad
class Recipe:  # ❌ Plain class, no validation
    def __init__(self, name, ingredients):
        self.name = name
        self.ingredients = ingredients
```

### FastAPI Routes

- Use dependency injection (`Depends`) for auth, db, config
- Keep routes thin (orchestration only)
- Move logic to services

```python
# ✓ Good
from fastapi import APIRouter, Depends

router = APIRouter()

@router.get("/recipes", response_model=List[RecipeOutput])
async def get_recipes(
    db: Database = Depends(get_database),
    category: Optional[str] = None,
) -> List[RecipeOutput]:
    """Get recipes, optionally filtered by category."""
    return await db.get_recipes(category=category)

# ✗ Bad
@app.get("/recipes")
def get_recipes():  # ❌ No types, no DI
    # Complex business logic embedded here
    # ...
    return recipes
```

### Error Handling

- Raise `HTTPException` with appropriate status codes
- **Never** swallow exceptions silently
- Log errors with context

```python
# ✓ Good
from fastapi import HTTPException, status

@router.post("/recipes")
async def create_recipe(recipe: RecipeInput) -> RecipeOutput:
    try:
        result = await recipes_service.create(recipe)
        return RecipeOutput.model_validate(result)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid recipe: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error creating recipe", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

# ✗ Bad
@router.post("/recipes")
def create_recipe(recipe: RecipeInput):
    try:
        result = recipes_service.create(recipe)
        return result
    except:  # ❌ Bare except
        return {"error": "Failed"}  # ❌ No logging, swallowed
```

---

## File Structure

```
backend/
├── __init__.py
├── app_core.py                  # App initialization
├── server.py                    # Main FastAPI app (~280 KB)
├── models.py                    # Database models
├── alerts.py                    # Alert service
├── auth_utils.py                # Authentication
├── ocr_service.py               # OCR integration
├── recipes_service.py           # Recipe business logic
├── product_catalog.py           # Catalog management
├── entitlements.py              # User entitlements
├── observability.py             # Logging & monitoring
├── service_limits.py            # Rate limiting
├── admin_service_control.py     # Admin controls
├── data/                        # Data files
├── migrations/                  # Database migrations
├── utils/                       # Shared utilities
├── scripts/                     # CLI scripts
├── tests/                       # Test suites (19 files)
│   ├── conftest.py              # Shared fixtures
│   ├── test_critical_bug_regressions.py
│   ├── test_recipe_suggestions_contract.py
│   ├── test_ocr_service.py
│   └── [... 15+ more]
└── docs/                        # API documentation
```

---

## Testing Patterns

### Test Setup (conftest.py)

```python
# backend/tests/conftest.py
import pytest
from fastapi.testclient import TestClient
import httpx

from backend.server import app

@pytest.fixture
def client():
    """Provides test client for API testing."""
    return TestClient(app)

@pytest.fixture
async def async_client():
    """Provides async client for async testing."""
    async with httpx.AsyncClient(app=app) as client:
        yield client

@pytest.fixture
def mock_db(mocker):
    """Mock database for unit tests."""
    return mocker.patch('backend.models.get_db')
```

### Unit Test Template

```python
import pytest
from backend.recipes_service import filter_recipes_by_category

def test_returns_recipes_for_matching_category():
    # Arrange
    recipes = [
        {'name': 'Pasta', 'category': 'Italian'},
        {'name': 'Sushi', 'category': 'Japanese'},
    ]

    # Act
    result = filter_recipes_by_category(recipes, 'Italian')

    # Assert
    assert len(result) == 1
    assert result[0]['name'] == 'Pasta'
```

### Integration Test Template (API)

```python
import pytest

@pytest.mark.asyncio
async def test_get_recipes_returns_list(async_client):
    # Act
    response = await async_client.get("/api/recipes")

    # Assert
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert all('name' in r for r in data)
```

### Mocking Strategy

```python
from unittest.mock import patch, AsyncMock

# ✓ OK: Mock external service (OCR API)
@patch('backend.ocr_service.call_ocr_api')
def test_ocr_fallback(mock_ocr):
    mock_ocr.side_effect = Exception("API down")
    result = process_receipt()
    assert result.status == 'fallback'

# ✓ OK: Mock async external call
@pytest.mark.asyncio
async def test_fetch_with_timeout(async_client, mocker):
    mock_fetch = mocker.patch(
        'backend.external_api.fetch',
        side_effect=asyncio.TimeoutError(),
    )
    response = await async_client.get("/api/data")
    assert response.status_code == 504

# ✗ DON'T: Mock business logic
# @patch('backend.recipes_service.filter_recipes')  # ❌ Testing filter? Don't mock it!
```

### Using Fixtures for Shared Data

```python
# backend/tests/conftest.py
@pytest.fixture
def sample_recipe():
    """Provides a sample recipe for tests."""
    return {
        'name': 'Pasta Carbonara',
        'category': 'Italian',
        'ingredients': ['pasta', 'eggs', 'bacon'],
    }

# Usage in test
def test_recipe_calculation(sample_recipe):
    result = calculate_nutrition(sample_recipe)
    assert result['calories'] > 0
```

---

## Type Checking (mypy)

```bash
# Check all backend code
mypy backend/

# Strict mode (recommended)
mypy --strict backend/

# Show unchecked types
mypy --show-error-codes backend/
```

**Rules**:
- No `type: ignore` without comment
- No `Any` unless genuinely unavoidable
- Use Protocol for duck typing when needed

```python
# ✓ Good - explicit protocol
from typing import Protocol

class Database(Protocol):
    async def get_recipes(self) -> List[Recipe]: ...

# ✗ Avoid - too permissive
def use_db(db: Any) -> Any:
    pass
```

---

## Async Patterns

All database and I/O operations should be async:

```python
# ✓ Good
@router.get("/recipes")
async def get_recipes(db: Database = Depends(get_db)) -> List[RecipeOutput]:
    recipes = await db.get_all()
    return recipes

# ✗ Bad
@router.get("/recipes")
def get_recipes(db: Database = Depends(get_db)):
    recipes = db.get_all()  # ❌ Blocking call, blocks event loop
    return recipes
```

---

## Error Handling & Logging

```python
import logging

logger = logging.getLogger(__name__)

# ✓ Good - clear error context
def calculate_expense(transactions: List[Transaction]) -> float:
    try:
        total = sum(t.amount for t in transactions)
        logger.debug(f"Calculated expense: {total}")
        return total
    except TypeError as e:
        logger.error(
            f"Invalid transaction amount type",
            extra={'transactions': [t.id for t in transactions]},
            exc_info=True,
        )
        raise ValueError(f"Invalid transaction: {str(e)}")

# ✗ Bad - swallowed error
def calculate_expense(transactions):
    try:
        return sum(t.amount for t in transactions)
    except:
        return 0  # ❌ Silent failure!
```

---

## Database Patterns

### Query Construction

```python
# ✓ Good - parameterized, safe
async def get_recipes_by_category(db: Database, category: str) -> List[Recipe]:
    return await db.query(Recipe).filter(Recipe.category == category).all()

# ✗ Bad - SQL injection risk
query = f"SELECT * FROM recipes WHERE category = '{category}'"
```

### Migrations

- Use Alembic (or similar) for schema changes
- Migrations are reversible (supports rollback)
- Test migrations on real database clone

---

## Configuration

- Use environment variables for config
- Separate dev, test, prod configs
- Never hardcode secrets

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    api_key: str
    debug: bool = False

    class Config:
        env_file = ".env"

settings = Settings()  # Loads from .env or environment
```

---

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Blocking operations in async routes | Use `await` for all I/O |
| N+1 query problem | Use eager loading, batch queries |
| Unhandled exceptions | Log + raise HTTPException |
| Type issues discovered at runtime | Use mypy + test strictly typed |
| Race conditions on concurrent writes | Use database constraints + transactions |
| Large response payloads | Implement pagination, pagination tokens |

---

## Performance

- Profile slow endpoints: `pip install pyinstrument`
- Use database indexes for frequent queries
- Implement caching (Redis) for expensive operations
- Limit response size (pagination)

```python
@router.get("/recipes")
async def get_recipes(
    db: Database = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> List[RecipeOutput]:
    """Get paginated recipes."""
    recipes = await db.get_recipes(skip=skip, limit=limit)
    return recipes
```

---

## Debugging

```bash
# Run with logging
LOGLEVEL=DEBUG uvicorn server:app --reload

# Use pdb
import pdb; pdb.set_trace()

# Check database directly (if MongoDB)
# mongo <connection-string> --eval "db.recipes.find().limit(1)"
```

---

## References

- [FastAPI docs](https://fastapi.tiangolo.com/)
- [Pydantic v2](https://docs.pydantic.dev/latest/)
- [pytest documentation](https://docs.pytest.org/)
- [mypy user guide](https://mypy.readthedocs.io/)
- [SQLAlchemy async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
