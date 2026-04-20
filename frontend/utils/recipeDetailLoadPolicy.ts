export interface RecipeDetailLoadPolicyInput {
  hasRecipeInCache: boolean;
  hasInFlightRequest: boolean;
}

export interface RecipeDetailLoadPolicyResult {
  useCacheFirst: boolean;
  shouldFetchFromBackend: boolean;
  shouldAwaitInFlight: boolean;
}

export function resolveRecipeDetailLoadPolicy(input: RecipeDetailLoadPolicyInput): RecipeDetailLoadPolicyResult {
  if (input.hasRecipeInCache) {
    return {
      useCacheFirst: true,
      shouldFetchFromBackend: false,
      shouldAwaitInFlight: false,
    };
  }
  if (input.hasInFlightRequest) {
    return {
      useCacheFirst: false,
      shouldFetchFromBackend: false,
      shouldAwaitInFlight: true,
    };
  }
  return {
    useCacheFirst: false,
    shouldFetchFromBackend: true,
    shouldAwaitInFlight: false,
  };
}
