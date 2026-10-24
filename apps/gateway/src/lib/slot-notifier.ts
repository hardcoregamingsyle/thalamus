/** Uses the same Brevo service as shared-account verification emails. */
export function createSlotNotifier(
  apiKey: string,
  from: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  return {
    async send(email: string, accountId: string): Promise<void> {
      const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: "NAMELESS", email: from },
          to: [{ email }],
          headers: { idempotencyKey: accountId },
          subject: "Your NAMELESS slot is ready",
          textContent:
            "A slot is ready for your NAMELESS account. Sign in at https://nameless.is/console to get started.",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Slot notification was not accepted by the email provider");
    },
  };
}
