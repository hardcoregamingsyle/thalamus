// Production Identity: calls the shared Convex deployment's HTTP API
// (docs/architecture.md §4). The contract is pinned by function name, the
// same way the agentoverflow repo's frontend/src/lib/thalamusApi.ts pins it:
//   customAuth:sendOtp        (action)   {email} -> null
//   customAuth:verifyOtp      (action)   {email, code} -> {token, userId, isNewUser}
//   customAuthHelpers:getUserByToken (query)    {token} -> user | null
//   customAuthHelpers:signOut       (mutation) {token} -> null

import type { Identity, IdentityUser, VerifyOtpResult } from "../types.js";

type ConvexFunctionKind = "query" | "mutation" | "action";

interface ConvexSuccess {
  status: "success";
  value: unknown;
}

interface ConvexError {
  status: "error";
  errorMessage: string;
  errorData?: unknown;
}

type ConvexResponse = ConvexSuccess | ConvexError;

/** The subset of customAuthHelpers:getUserByToken's user document the gateway reads. */
interface ConvexUserDoc {
  _id: string;
  email?: string;
}

async function callConvex(
  convexUrl: string,
  kind: ConvexFunctionKind,
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${convexUrl.replace(/\/$/, "")}/api/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  if (!response.ok) {
    throw new Error(`Convex ${kind} ${path} failed with HTTP ${response.status}`);
  }
  const data = (await response.json()) as ConvexResponse;
  if (data.status === "error") {
    throw new Error(`Convex ${kind} ${path} failed: ${data.errorMessage}`);
  }
  return data.value;
}

export function createConvexIdentity(convexUrl: string): Identity {
  return {
    async getUserByToken(token: string): Promise<IdentityUser | null> {
      const value = await callConvex(convexUrl, "query", "customAuthHelpers:getUserByToken", {
        token,
      });
      if (!value) return null;
      const user = value as ConvexUserDoc;
      return { id: user._id, email: user.email ?? null };
    },
    async sendOtp(email: string): Promise<void> {
      await callConvex(convexUrl, "action", "customAuth:sendOtp", { email });
    },
    async verifyOtp(email: string, code: string): Promise<VerifyOtpResult> {
      const value = await callConvex(convexUrl, "action", "customAuth:verifyOtp", { email, code });
      return value as VerifyOtpResult;
    },
    async signOut(token: string): Promise<void> {
      await callConvex(convexUrl, "mutation", "customAuthHelpers:signOut", { token });
    },
  };
}
