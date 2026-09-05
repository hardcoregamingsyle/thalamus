// Pins the consent-region gate in functions/geo.js.
//
// The product decision is narrow and easy to break by accident: a banner for
// UK/EU/EEA visitors and untouched analytics everywhere else. Widening the set
// taxes conversion in markets that never required it; narrowing it drops a
// consent gate that is legally required. Neither failure is visible from the
// running site, so it is asserted here instead.
import { describe, expect, test } from "bun:test";
// @ts-expect-error — plain JS Pages Function, no types
import { onRequestGet } from "../functions/geo.js";

function verdict(country: string | null) {
  const res = onRequestGet({ request: { cf: country === null ? undefined : { country } } });
  return res.json() as Promise<{ country: string | null; consentRequired: boolean }>;
}

describe("geo consent gate", () => {
  test.each(["GB", "DE", "FR", "IE", "NL", "ES", "IT", "PL", "SE", "NO", "IS", "LI", "CH"])(
    "%s requires consent",
    async (c) => {
      expect((await verdict(c)).consentRequired).toBe(true);
    },
  );

  test.each(["US", "IN", "CA", "AU", "BR", "JP", "SG", "AE", "NG", "MX"])(
    "%s does not require consent",
    async (c) => {
      expect((await verdict(c)).consentRequired).toBe(false);
    },
  );

  // Fail closed: an unknown origin gets the stricter treatment, not the looser.
  test("unknown country requires consent", async () => {
    expect((await verdict(null)).consentRequired).toBe(true);
  });

  test("Tor exit requires consent", async () => {
    expect((await verdict("T1")).consentRequired).toBe(true);
  });

  test("the country is reported back", async () => {
    expect((await verdict("DE")).country).toBe("DE");
  });

  test("never cached — a shared entry would leak one visitor's regime to the next", () => {
    const res = onRequestGet({ request: { cf: { country: "GB" } } });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
