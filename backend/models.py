from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    is_premium: bool
    is_verified: bool = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class RegisterResponse(BaseModel):
    message: str
    email: str


class VerifyEmailBody(BaseModel):
    token: str


class ResendVerificationBody(BaseModel):
    email: EmailStr


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


class ProductBase(BaseModel):
    barcode: Optional[str] = None
    name: str = ""
    brand: Optional[str] = ""
    image_url: Optional[str] = ""
    category: Optional[str] = None
    quantity: Optional[str] = ""


class StockItemCreate(ProductBase):
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


class StockItem(StockItemCreate):
    id: str
    added_date: str
    status: str
    consumed_date: Optional[str] = None
    thrown_date: Optional[str] = None
    food_category: Optional[str] = None


class StockItemUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    quantity: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


class ShelfLife(BaseModel):
    category_fr: str = ""
    refrigerator_days: Optional[int] = None
    freezer_days: Optional[int] = None
    pantry_days: Optional[int] = None
    tips_fr: str = ""


class ProductLookupResponse(BaseModel):
    found: bool
    product: Optional[ProductBase] = None
    shelf_life: Optional[ShelfLife] = None


class StatsResponse(BaseModel):
    total_items: int
    expiring_soon: int
    expired: int
    consumed_this_week: int
    thrown_this_week: int


class PushTokenBody(BaseModel):
    token: str


class RecipeDifficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class RecipeMealType(str, Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    dessert = "dessert"
    snack = "snack"
    aperitif = "aperitif"


class RecipeCuisine(str, Enum):
    francaise = "française"


class RecipeCompat(BaseModel):
    storage_focus: list[str] = Field(default_factory=list)


class RecipeSource(BaseModel):
    type: str = "local_catalog"
    name: str = "keepeat"


class Recipe(BaseModel):
    id: str = Field(..., min_length=3)
    title: str = Field(..., min_length=1)
    summary: str = ""
    ingredients_required: list[str] = Field(default_factory=list, min_length=1)
    ingredients_optional: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list, min_length=1)
    prep_time_min: int = Field(..., ge=0)
    cook_time_min: int = Field(..., ge=0)
    difficulty: RecipeDifficulty
    tags: list[str] = Field(default_factory=list)
    meal_type: list[RecipeMealType] = Field(default_factory=list, min_length=1)
    cuisine: RecipeCuisine
    servings: int = Field(..., ge=1)
    search_terms: list[str] = Field(default_factory=list)
    compat: RecipeCompat = Field(default_factory=RecipeCompat)
    source: RecipeSource = Field(default_factory=RecipeSource)
    version: int = Field(default=1, ge=1)


class RecipeCatalogResponse(BaseModel):
    recipes: list[Recipe]
    total: int




class RecipeMatchStatus(str, Enum):
    ready = "ready"
    almost = "almost"
    inspiration = "inspiration"


class RecipeGroupedSuggestion(BaseModel):
    id: str
    title: str
    used_ingredients: list[str] = Field(default_factory=list)
    missing_ingredients: list[str] = Field(default_factory=list)
    optional_ingredients_used: list[str] = Field(default_factory=list)
    score: float = Field(..., ge=0.0)
    prep_time_min: int = Field(..., ge=0)
    cook_time_min: int = Field(..., ge=0)
    difficulty: RecipeDifficulty
    tags: list[str] = Field(default_factory=list)
    meal_type: list[RecipeMealType] = Field(default_factory=list)
    cuisine: RecipeCuisine
    servings: int = Field(..., ge=1)
    match_status: RecipeMatchStatus
    matched_required_count: int = Field(..., ge=0)
    missing_required_count: int = Field(..., ge=0)


class RecipeSuggestionGroupsResponse(BaseModel):
    ready: list[RecipeGroupedSuggestion] = Field(default_factory=list)
    almost: list[RecipeGroupedSuggestion] = Field(default_factory=list)
    inspiration: list[RecipeGroupedSuggestion] = Field(default_factory=list)

class RecipeSuggestion(BaseModel):
    id: str
    title: str
    image: str = ""
    usedIngredients: list[str] = Field(default_factory=list)
    missedIngredients: list[str] = Field(default_factory=list)
    optionalIngredientsUsed: list[str] = Field(default_factory=list)
    sourceUrl: str = ""
    is_fallback: bool = False
    instructions_summary: str = ""
    prep_time_min: Optional[int] = None
    cook_time_min: Optional[int] = None
    difficulty: RecipeDifficulty
    tags: list[str] = Field(default_factory=list)
    meal_type: list[RecipeMealType] = Field(default_factory=list)
    cuisine: RecipeCuisine
    servings: int
    score: float = Field(..., ge=0.0)
    suggestion_type: str = Field(default="perfect")
    used_ingredients_count: int = Field(default=0, ge=0)
    missing_ingredients_count: int = Field(default=0, ge=0)
    debug: dict[str, object] = Field(default_factory=dict)
