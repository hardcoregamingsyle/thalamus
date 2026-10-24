import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { validatedEmail } from "./authEmail";

export const sendOtpEmail = internalAction({
  args: { email: v.string(), code: v.string() },
  handler: async (_ctx, { email, code }): Promise<void> => {
    const apiKey = process.env.BREVO_EMAIL_SENDER;
    if (!apiKey) throw new Error("Email sender is not configured");
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        sender: {
          name: "NAMELESS",
          email:
            process.env.WAITLIST_EMAIL_FROM ?? "thalamus-onboarding@mail.aphantic.skinticals.com",
        },
        to: [{ email }],
        subject: "Your NAMELESS verification code",
        textContent: `Your NAMELESS verification code is ${code}. It expires in 15 minutes. If you didn't request this, ignore this email.`,
      }),
    });
    if (!response.ok) throw new Error("Verification email was not accepted");
  },
});

export const sendOtp = action({
  args: { email: v.string() },
  handler: async (ctx, { email: rawEmail }): Promise<{ success: true }> => {
    const email = validatedEmail(rawEmail);
    if (
      await ctx.runQuery(internal.customAuthHelpers.isDomainBlacklisted, {
        domain: email.split("@")[1]!,
      })
    )
      throw new Error("Email domain is blocked");
    // Rejection sampling avoids modulo bias and uses a cryptographic RNG.
    const random = new Uint32Array(1);
    do {
      crypto.getRandomValues(random);
    } while (random[0] >= 4_294_000_000);
    const code = String(random[0] % 1_000_000).padStart(6, "0");
    const stored = await ctx.runMutation(internal.customAuthHelpers.storeOtp, {
      email,
      code,
      expiresAt: Date.now() + 15 * 60_000,
    });
    if (stored)
      await ctx.scheduler.runAfter(0, internal.customAuth.sendOtpEmail, {
        email: rawEmail.trim().toLowerCase(),
        code,
      });
    return { success: true };
  },
});

export const verifyOtp = action({
  args: { email: v.string(), code: v.string() },
  handler: async (
    ctx,
    { email: rawEmail, code },
  ): Promise<{ token: string; userId: string; isNewUser: boolean }> => {
    const email = validatedEmail(rawEmail);
    if (
      await ctx.runQuery(internal.customAuthHelpers.isDomainBlacklisted, {
        domain: email.split("@")[1]!,
      })
    )
      throw new Error("Email domain is blocked");
    const result = await ctx.runMutation(internal.customAuthHelpers.verifyAndCreateSession, {
      email,
      code: code.trim(),
    });
    if (!result) throw new Error("Invalid or expired verification code");
    return result;
  },
});
