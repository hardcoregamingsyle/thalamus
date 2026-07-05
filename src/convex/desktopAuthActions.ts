"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// ── Helpers ─────────────────────────────────────────────────────────────

// Generate an 8-char alphanumeric code (no ambiguous chars)
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I,O,0,1
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Step 1: Desktop app calls this to get a code ────────────────────────

export const createCode = action({
  args: {},
  handler: async (ctx) => {
    // Generate unique code
    let code = generateCode();
    for (let attempts = 0; attempts < 10; attempts++) {
      const existing = await ctx.runQuery(internal.desktopAuth.getCode, { code });
      if (!existing) break;
      code = generateCode();
    }

    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    await ctx.runMutation(internal.desktopAuth.storeCode, { code, expiresAt });

    return { code, expiresAt };
  },
});
