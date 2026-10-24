import { describe, expect, test } from "bun:test";
import { createSlotNotifier } from "../src/lib/slot-notifier.js";

describe("slot notification", () => {
  test("sends the invitation with a stable deduplication key", async () => {
    const requests: Request[] = [];
    const notifier = createSlotNotifier(
      "test-only-key",
      "hello@nameless.is",
      async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
      },
    );
    await notifier.send("person@example.com", "account-1");
    await notifier.send("person@example.com", "account-1");
    expect(requests[0]?.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(requests[0]?.headers.get("api-key")).toBe("test-only-key");
    const body = (await requests[0]!.json()) as {
      to: { email: string }[];
      textContent: string;
      headers: { idempotencyKey: string };
    };
    const retry = (await requests[1]!.json()) as { headers: { idempotencyKey: string } };
    expect(body.headers.idempotencyKey).toBe(retry.headers.idempotencyKey);
    expect(body.to).toEqual([{ email: "person@example.com" }]);
    expect(body.textContent).toContain("https://nameless.is/console");
  });

  test("rejects provider failures", async () => {
    const notifier = createSlotNotifier(
      "test-only-key",
      "hello@nameless.is",
      async () => new Response(null, { status: 429 }),
    );
    await expect(notifier.send("person@example.com", "account-1")).rejects.toThrow("not accepted");
  });
});
