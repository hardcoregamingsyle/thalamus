// Standalone CLI: `bun run dev` serves the mock model server on port 8788
// for the gateway to develop against locally.

import { createMockModelServer } from "./server.js";

const secret = process.env.THALAMUS_MODEL_SERVER_SECRET;
if (!secret) {
  console.error("THALAMUS_MODEL_SERVER_SECRET must be set");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8788);
const server = createMockModelServer({ secret });

Bun.serve({
  port,
  fetch: (request) => server.fetch(request),
});

console.log(`mock model server listening on http://localhost:${port}`);
