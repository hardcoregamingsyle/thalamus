// Catch-all: every /v1/* request (the API-key-authenticated, OpenAI-
// compatible surface) forwards straight to the gateway Worker through the
// GATEWAY service binding, unchanged — status, headers, and the body
// (including SSE chat-completion streams) all pass through as-is.
interface Env {
  GATEWAY: Fetcher;
}

export const onRequest: PagesFunction<Env> = (context) => {
  return context.env.GATEWAY.fetch(context.request);
};
