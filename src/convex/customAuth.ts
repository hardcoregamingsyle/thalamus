"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import axios from "axios";

// Send OTP via Brevo
export const sendOtp = action({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const email = args.email.toLowerCase().trim();

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store OTP in database
    await ctx.runMutation(internal.customAuthHelpers.storeOtp, { email, code, expiresAt });

    // Send via Brevo
    const apiKey = process.env.BREVO_EMAIL_SENDER;
    if (!apiKey) throw new Error("BREVO_EMAIL_SENDER not set");

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "AgentAI", email: "onboarding@agentaimail.skinticals.com" },
        to: [{ email }],
        subject: "Your AgentAI Verification Code",
        htmlContent: `
          <div style="font-family: monospace; background: #0a0a0a; color: #00ff41; padding: 32px; max-width: 480px; margin: 0 auto; border: 1px solid #00ff41;">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 16px; letter-spacing: 4px;">AGENT_AI</div>
            <div style="color: #888; font-size: 12px; margin-bottom: 24px;">// AUTHENTICATION_REQUIRED</div>
            <div style="color: #ccc; font-size: 13px; margin-bottom: 16px;">Your verification code:</div>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 12px; color: #00ff41; background: #111; padding: 16px; text-align: center; border: 1px solid #00ff41; margin-bottom: 24px;">${code}</div>
            <div style="color: #666; font-size: 11px;">This code expires in 15 minutes.</div>
          </div>
        `,
        textContent: `Your AgentAI verification code is: ${code}\n\nThis code expires in 15 minutes.`,
      },
      {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log("OTP sent to", email);
    return { success: true };
  },
});

// Verify OTP and create session
export const verifyOtp = action({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, args): Promise<{ token: string; userId: string }> => {
    const email = args.email.toLowerCase().trim();
    const code = args.code.trim();

    const result = await ctx.runMutation(internal.customAuthHelpers.verifyAndCreateSession, {
      email,
      code,
    });

    return result;
  },
});
