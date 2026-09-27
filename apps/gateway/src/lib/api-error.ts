// Plain JSON error envelope for the /api/* app routes (distinct from the
// OpenAI-shaped errors on /v1/*, which use @thalamus/contract's
// buildApiError/apiErrorStatus instead).

export function apiError(message: string): { error: string } {
  return { error: message };
}
