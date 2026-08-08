/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * The expression `err instanceof Error ? err.message : "<fallback>"` was
 * copy-pasted at 55+ call sites; this is that expression, once. If error
 * reporting (Sentry-style) is ever added, this is the single place to hook it.
 */
export function errMsg(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
