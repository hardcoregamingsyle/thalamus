import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    try {
      await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
          sender: {
            name: "AgentAI",
            email: "onboarding@AgentAiMail.skinticals.com",
          },
          to: [{ email }],
          subject: "Your AgentAI Verification Code",
          htmlContent: `
            <div style="font-family: monospace; background: #0a0a0a; color: #00ff41; padding: 32px; max-width: 480px; margin: 0 auto; border: 1px solid #00ff41;">
              <div style="font-size: 18px; font-weight: bold; margin-bottom: 16px; letter-spacing: 4px;">AGENT_AI</div>
              <div style="color: #888; font-size: 12px; margin-bottom: 24px;">// AUTHENTICATION_REQUIRED</div>
              <div style="color: #ccc; font-size: 13px; margin-bottom: 16px;">Your verification code:</div>
              <div style="font-size: 36px; font-weight: bold; letter-spacing: 12px; color: #00ff41; background: #111; padding: 16px; text-align: center; border: 1px solid #00ff41; margin-bottom: 24px;">${token}</div>
              <div style="color: #666; font-size: 11px;">This code expires in 15 minutes.</div>
              <div style="color: #666; font-size: 11px; margin-top: 8px;">If you did not request this, ignore this email.</div>
            </div>
          `,
          textContent: `Your AgentAI verification code is: ${token}\n\nThis code expires in 15 minutes.`,
        },
        {
          headers: {
            "api-key": process.env.BREVO_EMAIL_SENDER,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});