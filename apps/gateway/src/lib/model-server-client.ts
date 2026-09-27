// Fetch-based client for docs/model-server.md, signing every request with
// @thalamus/contract's X-Thalamus-Signature helper. `fetchImpl` defaults to
// the global fetch and is overridden in tests to call an in-process mock
// model server's own `fetch(request)` directly, with no real network hop.

import { signRequest, type GenerateRequest } from "@thalamus/contract";
import type { ModelServerClient } from "../types.js";

export interface ModelServerClientOptions {
  baseUrl: string;
  secret: string;
  fetchImpl?: (request: Request) => Promise<Response>;
}

export function createModelServerClient(options: ModelServerClientOptions): ModelServerClient {
  const fetchImpl = options.fetchImpl ?? ((request: Request) => fetch(request));
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function signedRequest(method: string, path: string, body: unknown): Promise<Response> {
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const signature = await signRequest({ secret: options.secret, body: bodyText });
    const headers: Record<string, string> = { "x-thalamus-signature": signature };
    if (bodyText) headers["content-type"] = "application/json";
    return fetchImpl(
      new Request(`${baseUrl}${path}`, { method, headers, body: bodyText || undefined }),
    );
  }

  return {
    generate(request: GenerateRequest): Promise<Response> {
      return signedRequest("POST", "/internal/v1/generate", request);
    },
    async endSession(sessionId: string): Promise<void> {
      await signedRequest("POST", `/internal/v1/sessions/${encodeURIComponent(sessionId)}/end`, {});
    },
    async warm(userKey: string): Promise<void> {
      await signedRequest("POST", "/internal/v1/warm", { user_key: userKey });
    },
    async deleteUser(userKey: string): Promise<void> {
      await signedRequest("DELETE", `/internal/v1/users/${encodeURIComponent(userKey)}`, {});
    },
    async healthz(): Promise<boolean> {
      const response = await signedRequest("GET", "/internal/healthz", undefined);
      return response.ok;
    },
  };
}
