import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs — Thalamus",
};

const ERROR_ROWS: { code: string; status: number; meaning: string }[] = [
  { code: "waitlisted", status: 403, meaning: "The account hasn't been invited yet." },
  { code: "invalid_api_key", status: 401, meaning: "The key is missing, malformed, or revoked." },
  { code: "rate_limited", status: 429, meaning: "The account's rate limit was exceeded. Retry after the given delay." },
  { code: "lease_held", status: 409, meaning: "Another request for the same end user is already in flight." },
  { code: "invalid_request", status: 400, meaning: "The request body didn't match the expected shape." },
  { code: "model_not_found", status: 404, meaning: "The requested model id doesn't exist." },
  { code: "upstream_unavailable", status: 503, meaning: "The model server is temporarily unavailable. Retry after the given delay." },
  { code: "internal_error", status: 500, meaning: "Something went wrong on our side." },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">API reference</h1>
      <p className="mt-2 text-muted-foreground">
        Thalamus serves Thalamus Sophon — a non-transformer architecture — through an
        OpenAI-compatible chat-completions API. Any OpenAI SDK works against it once you point
        the base URL at Thalamus.
      </p>

      <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {[
          ["authentication", "Authentication"],
          ["models", "Models"],
          ["chat-completions", "Chat completions"],
          ["streaming", "Streaming"],
          ["sessions", "Sessions"],
          ["errors", "Errors"],
          ["rate-limits", "Rate limits"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="no-underline hover:underline">
            {label}
          </a>
        ))}
      </nav>

      <section id="authentication" className="mt-10">
        <h2 className="text-lg font-medium">Authentication</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Create an API key in the{" "}
          <a href="/console">console</a>. Send it as a bearer token:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface p-4 text-sm">
          <code>Authorization: Bearer th_...</code>
        </pre>
        <p className="mt-2 text-sm text-muted-foreground">
          The raw key is shown once, when it's created. Thalamus stores only its hash.
        </p>
      </section>

      <section id="models" className="mt-10">
        <h2 className="text-lg font-medium">Models</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <code>GET /v1/models</code> lists the models an account may use. Thalamus currently
          serves one model, <code>thalamus-sophon-1.0</code>. Thalamus routes to no third-party
          models.
        </p>
      </section>

      <section id="chat-completions" className="mt-10">
        <h2 className="text-lg font-medium">Chat completions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <code>POST /v1/chat/completions</code> follows the OpenAI request and response shape:
          a <code>model</code>, a <code>messages</code> array, and an optional{" "}
          <code>stream</code> flag. The response's <code>usage</code> reports characters in and
          out; <code>prompt_tokens</code>/<code>completion_tokens</code> are{" "}
          <code>ceil(chars / 4)</code>, provided for SDK compatibility — billing is by
          characters.
        </p>
      </section>

      <section id="streaming" className="mt-10">
        <h2 className="text-lg font-medium">Streaming</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          With <code>stream: true</code>, the response is a standard SSE stream of{" "}
          <code>chat.completion.chunk</code> events, each carrying an incremental{" "}
          <code>delta</code>, followed by <code>data: [DONE]</code>.
        </p>
      </section>

      <section id="sessions" className="mt-10">
        <h2 className="text-lg font-medium">Sessions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Thalamus keeps conversation state server-side, so it only needs the turns it hasn't
          seen — but an unmodified OpenAI SDK resends the full <code>messages</code> array every
          call. Two ways to resolve that onto a session:
        </p>
        <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Automatic.</strong> Send the full transcript
            each time, as the SDK already does. Thalamus matches the resent prefix against the
            account's sessions for that end user and forwards only the new turns. A changed
            earlier message starts a fresh session.
          </li>
          <li>
            <strong className="text-foreground">Explicit.</strong> Pass <code>session_id</code>{" "}
            in the body, or as <code>X-Thalamus-Session-Id</code>, to skip that matching. The
            response returns the session id in the same header.
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          Set <code>user</code> to a stable per-end-user identifier so sessions resolve
          correctly across requests. An API session ends after 30 minutes idle; the chat app ends
          one when the conversation is closed.
        </p>
      </section>

      <section id="errors" className="mt-10">
        <h2 className="text-lg font-medium">Errors</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Errors follow the OpenAI shape, <code>{"{ error: { message, type, code } }"}</code>.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 font-normal">Code</th>
              <th className="py-2 font-normal">HTTP status</th>
              <th className="py-2 font-normal">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {ERROR_ROWS.map((row) => (
              <tr key={row.code} className="border-b border-border align-top">
                <td className="py-2 font-mono">{row.code}</td>
                <td className="py-2">{row.status}</td>
                <td className="py-2 text-muted-foreground">{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="rate-limits" className="mt-10">
        <h2 className="text-lg font-medium">Rate limits</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Each account has a token-bucket rate limit tied to its plan. An exceeded limit returns{" "}
          <code>429</code> with a <code>Retry-After</code> header. During the free beta every
          account is metered from its first request, ahead of paid billing.
        </p>
      </section>
    </div>
  );
}
