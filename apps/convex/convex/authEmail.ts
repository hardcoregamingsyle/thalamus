const TEMP_MAIL_DOMAINS = new Set([
  "10minutemail.co.uk",
  "10minutemail.com",
  "10minutemail.de",
  "10minutemail.info",
  "10minutemail.net",
  "10minutemail.org",
  "10minutemail.us",
  "20minutemail.com",
  "20minutemail.it",
  "cool.fr.nf",
  "courriel.fr.nf",
  "discard.email",
  "discard.net",
  "discard.org",
  "dispostable.com",
  "dispostable.net",
  "dispostable.org",
  "fakeinbox.com",
  "fakeinbox.net",
  "fakeinbox.org",
  "filzmail.com",
  "filzmail.net",
  "filzmail.org",
  "getairmail.com",
  "getairmail.net",
  "getairmail.org",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "jetable.fr.nf",
  "maildrop.cc",
  "maildrop.net",
  "maildrop.org",
  "mailexpire.com",
  "mailexpire.net",
  "mailexpire.org",
  "mailinator.com",
  "mailnesia.com",
  "mailnesia.net",
  "mailnesia.org",
  "mailnull.com",
  "mailnull.net",
  "mailnull.org",
  "mailtemp.info",
  "mailtemp.net",
  "mailtemp.org",
  "mega.zik.dj",
  "mohmal.com",
  "mohmal.net",
  "mohmal.org",
  "moncourrier.fr.nf",
  "monemail.fr.nf",
  "monmail.fr.nf",
  "nomail.xl.cx",
  "nospam.ze.tc",
  "sharklasers.com",
  "spam4.me",
  "spamfree24.de",
  "spamfree24.eu",
  "spamfree24.info",
  "spamfree24.net",
  "spamfree24.org",
  "spamgourmet.com",
  "spamgourmet.info",
  "spamgourmet.me",
  "spamgourmet.net",
  "spamgourmet.org",
  "speed.1s.fr",
  "temp-mail.io",
  "temp-mail.org",
  "temp-mail.ru",
  "tempmail.com",
  "tempmail.de",
  "tempmail.net",
  "tempmail.org",
  "throwam.com",
  "throwam.net",
  "throwam.org",
  "throwam.xyz",
  "throwaway.email",
  "throwaway.net",
  "throwaway.org",
  "trashmail.at",
  "trashmail.com",
  "trashmail.io",
  "trashmail.me",
  "trashmail.net",
  "trashmail.org",
  "trashmail.xyz",
  "yopmail.com",
  "yopmail.fr",
]);

export function normalizeEmail(raw: string): string {
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

export function validatedEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Invalid email address");
  if (TEMP_MAIL_DOMAINS.has(email.split("@")[1]!))
    throw new Error("Disposable email addresses are not allowed");
  return email;
}
