export const GENERIC_STREAM_FAILURE =
  "Sorry, I couldn't generate a response. Please try again.";

/** The streaming endpoint returns HTTP 200 even when every provider failed. */
export function isGenericStreamFailure(text: string): boolean {
  const normalized = text.trim();
  return normalized.length === 0 || normalized === GENERIC_STREAM_FAILURE;
}
