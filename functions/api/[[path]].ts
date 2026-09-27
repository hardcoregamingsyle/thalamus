// Catch-all: every /api/* request (the session-cookie-authenticated app
// surface) forwards straight to the gateway Worker through the GATEWAY
// service binding, unchanged — status, headers (including Set-Cookie), and
// the body (including SSE) all stream through as-is.
interface Env {
  GATEWAY: Fetcher;
}

export const onRequest: PagesFunction<Env> = (context) => {
  return context.env.GATEWAY.fetch(context.request);
};
