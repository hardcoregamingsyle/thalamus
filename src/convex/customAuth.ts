"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Known temp/disposable email domains (partial list — extended at runtime)
const TEMP_MAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info", "guerrillamailblock.com",
  "grr.la", "sharklasers.com", "guerrillamailblock.com", "spam4.me",
  "yopmail.com", "yopmail.fr", "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc",
  "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr", "courriel.fr.nf", "moncourrier.fr.nf",
  "monemail.fr.nf", "monmail.fr.nf", "trashmail.com", "trashmail.at", "trashmail.io",
  "trashmail.me", "trashmail.net", "trashmail.org", "trashmail.xyz",
  "throwam.com", "throwam.net", "throwam.org", "throwam.xyz",
  "dispostable.com", "dispostable.net", "dispostable.org",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamgourmet.me", "spamgourmet.info",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "sharklasers.com", "guerrillamail.info", "grr.la", "guerrillamail.biz",
  "guerrillamail.de", "guerrillamail.net", "guerrillamail.org", "guerrillamail.com",
  "spam4.me", "yopmail.com", "yopmail.fr", "cool.fr.nf", "jetable.fr.nf",
  "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  "10minutemail.com", "10minutemail.net", "10minutemail.org", "10minutemail.de",
  "10minutemail.co.uk", "10minutemail.info", "10minutemail.us",
  "20minutemail.com", "20minutemail.it",
  "mailnesia.com", "mailnesia.net", "mailnesia.org",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamgourmet.me", "spamgourmet.info",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "getairmail.com", "getairmail.net", "getairmail.org",
  "filzmail.com", "filzmail.net", "filzmail.org",
  "discard.email", "discard.net", "discard.org",
  "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net",
  "mailexpire.com", "mailexpire.net", "mailexpire.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamgourmet.me", "spamgourmet.info",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamgourmet.me", "spamgourmet.info",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "getairmail.com", "getairmail.net", "getairmail.org",
  "filzmail.com", "filzmail.net", "filzmail.org",
  "discard.email", "discard.net", "discard.org",
  "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net",
  "mailexpire.com", "mailexpire.net", "mailexpire.org",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "guerrillamailblock.com", "grr.la", "sharklasers.com",
  "spam4.me", "yopmail.com", "yopmail.fr",
  "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc",
  "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "20minutemail.com", "20minutemail.it",
  "mailnesia.com", "mailnesia.net", "mailnesia.org",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "getairmail.com", "getairmail.net", "getairmail.org",
  "filzmail.com", "filzmail.net", "filzmail.org",
  "discard.email", "discard.net", "discard.org",
  "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net",
  "mailexpire.com", "mailexpire.net", "mailexpire.org",
  "mohmal.com", "mohmal.net", "mohmal.org",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "getairmail.com", "getairmail.net", "getairmail.org",
  "filzmail.com", "filzmail.net", "filzmail.org",
  "discard.email", "discard.net", "discard.org",
  "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net",
  "mailexpire.com", "mailexpire.net", "mailexpire.org",
  "mohmal.com", "mohmal.net", "mohmal.org",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "guerrillamailblock.com", "grr.la", "sharklasers.com",
  "spam4.me", "yopmail.com", "yopmail.fr",
  "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc",
  "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "20minutemail.com", "20minutemail.it",
  "mailnesia.com", "mailnesia.net", "mailnesia.org",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "getairmail.com", "getairmail.net", "getairmail.org",
  "filzmail.com", "filzmail.net", "filzmail.org",
  "discard.email", "discard.net", "discard.org",
  "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net",
  "mailexpire.com", "mailexpire.net", "mailexpire.org",
  "mohmal.com", "mohmal.net", "mohmal.org",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "guerrillamailblock.com", "grr.la", "sharklasers.com",
  "spam4.me", "yopmail.com", "yopmail.fr",
  "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc",
  "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "20minutemail.com", "20minutemail.it",
  "mailnesia.com", "mailnesia.net", "mailnesia.org",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "getairmail.com", "getairmail.net", "getairmail.org",
  "filzmail.com", "filzmail.net", "filzmail.org",
  "discard.email", "discard.net", "discard.org",
  "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net",
  "mailexpire.com", "mailexpire.net", "mailexpire.org",
  "mohmal.com", "mohmal.net", "mohmal.org",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "guerrillamailblock.com", "grr.la", "sharklasers.com",
  "spam4.me", "yopmail.com", "yopmail.fr",
  "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc",
  "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "20minutemail.com", "20minutemail.it",
  "mailnesia.com", "mailnesia.net", "mailnesia.org",
  "mailnull.com", "mailnull.net", "mailnull.org",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "maildrop.cc", "maildrop.net", "maildrop.org",
  "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "mailtemp.net", "mailtemp.org", "mailtemp.info",
  "throwaway.email", "throwaway.net", "throwaway.org",
  "getairmail.com", "getairmail.net", "getairmail.org",
  "filzmail.com", "filzmail.net", "filzmail.org",
  "discard.email", "discard.net", "discard.org",
  "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net",
  "mailexpire.com", "mailexpire.net", "mailexpire.org",
  "mohmal.com", "mohmal.net", "mohmal.org",
]);

// Trusted domains — never auto-blacklisted
const TRUSTED_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me",
  "zoho.com", "aol.com", "msn.com", "ymail.com",
]);

/**
 * Normalize an email address:
 * - Lowercase
 * - For Gmail: remove dots from username, strip +suffix
 * - For all: strip +suffix from username
 */
function normalizeEmail(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const atIdx = lower.indexOf("@");
  if (atIdx === -1) return lower;

  let username = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  // Strip +suffix (for all providers)
  const plusIdx = username.indexOf("+");
  if (plusIdx !== -1) username = username.slice(0, plusIdx);

  // Gmail-specific: remove all dots from username
  if (domain === "gmail.com" || domain === "googlemail.com") {
    username = username.replace(/\./g, "");
  }

  return `${username}@${domain}`;
}

// Internal action to send email via Brevo (runs in background)
export const sendOtpEmail = internalAction({
  args: { email: v.string(), code: v.string() },
  handler: async (_ctx, args): Promise<void> => {
    const apiKey = process.env.BREVO_EMAIL_SENDER;
    if (!apiKey) throw new Error("BREVO_EMAIL_SENDER not set");

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Thalamus", email: "thalamus-onboarding@mail.aphantic.skinticals.com" },
        to: [{ email: args.email }],
        subject: "Your Thalamus Verification Code",
        htmlContent: `
          <div style="font-family: monospace; background: #0a0a0a; color: #00ff41; padding: 32px; max-width: 480px; margin: 0 auto; border: 1px solid #00ff41;">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 16px; letter-spacing: 4px;">THALAMUS</div>
            <div style="color: #888; font-size: 12px; margin-bottom: 24px;">// AUTHENTICATION_REQUIRED</div>
            <div style="color: #ccc; font-size: 13px; margin-bottom: 16px;">Your verification code:</div>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 12px; color: #00ff41; background: #111; padding: 16px; text-align: center; border: 1px solid #00ff41; margin-bottom: 24px;">${args.code}</div>
            <div style="color: #666; font-size: 11px;">This code expires in 15 minutes.</div>
          </div>
        `,
        textContent: `Your AgentAI verification code is: ${args.code}\n\nThis code expires in 15 minutes.`,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Brevo API error ${response.status}: ${err}`);
    }
    console.log("OTP email sent to", args.email);
  },
});

// Check domain abuse and potentially blacklist (runs in background)
export const checkDomainAbuse = internalAction({
  args: { domain: v.string(), newUserId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (TRUSTED_DOMAINS.has(args.domain)) return;

    // Count users with this domain
    const result = await ctx.runMutation(internal.customAuthHelpers.checkAndBlacklistDomain, {
      domain: args.domain,
      newUserId: args.newUserId,
    });

    if (result?.shouldBlacklist) {
      // Blacklist the domain and ban all users from it
      await ctx.runMutation(internal.customAuthHelpers.blacklistDomainAndBanUsers, {
        domain: args.domain,
        reason: "abuse",
      });
    }
  },
});

// Send OTP - stores OTP immediately, schedules email in background
export const sendOtp = action({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const rawEmail = args.email.toLowerCase().trim();
    const email = normalizeEmail(rawEmail);
    const domain = email.split("@")[1] ?? "";

    // Block temp mail domains
    if (TEMP_MAIL_DOMAINS.has(domain)) {
      throw new Error("Temporary/disposable email addresses are not allowed. Please use a permanent email address.");
    }

    // Check if domain is blacklisted
    const isBlacklisted = await ctx.runMutation(internal.customAuthHelpers.isDomainBlacklisted, { domain });
    if (isBlacklisted) {
      throw new Error("This email domain has been blocked due to abuse. If you believe this is a mistake, please contact support.");
    }

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store OTP in database immediately (use normalized email)
    await ctx.runMutation(internal.customAuthHelpers.storeOtp, { email, code, expiresAt });

    // Schedule email send in background (non-blocking) — send to original email
    await ctx.scheduler.runAfter(0, internal.customAuth.sendOtpEmail, { email: rawEmail, code });

    return { success: true };
  },
});

// Verify OTP and create session
export const verifyOtp = action({
  args: { email: v.string(), code: v.string(), referralCode: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ token: string; userId: string; isNewUser: boolean; referralSpins: number }> => {
    const rawEmail = args.email.toLowerCase().trim();
    const email = normalizeEmail(rawEmail);
    const domain = email.split("@")[1] ?? "";

    // Block temp mail domains
    if (TEMP_MAIL_DOMAINS.has(domain)) {
      throw new Error("Temporary/disposable email addresses are not allowed.");
    }

    // Check if domain is blacklisted
    const isBlacklisted = await ctx.runMutation(internal.customAuthHelpers.isDomainBlacklisted, { domain });
    if (isBlacklisted) {
      throw new Error("This email domain has been blocked due to abuse. If you believe this is a mistake, please contact support.");
    }

    const result = await ctx.runMutation(internal.customAuthHelpers.verifyAndCreateSession, {
      email,
      code: args.code.trim(),
      referralCode: args.referralCode,
    });

    // If new user, check domain abuse in background
    if (result.isNewUser && !TRUSTED_DOMAINS.has(domain)) {
      await ctx.scheduler.runAfter(0, internal.customAuth.checkDomainAbuse, {
        domain,
        newUserId: result.userId,
      });
    }

    return result;
  },
});