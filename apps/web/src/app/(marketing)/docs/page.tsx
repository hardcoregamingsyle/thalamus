import type { Metadata } from "next";
import { Code } from "@/components/docs/Code";
import { DocsSection } from "@/components/docs/DocsSection";
import { DocsShell, type DocsSectionMeta } from "@/components/docs/DocsShell";
import { DocsTable } from "@/components/docs/DocsTable";
import { CodeBlock, type CodeTab } from "@/components/ui/CodeBlock";

export const metadata: Metadata = {
  title: "Docs",
  description: "API reference for the Thalamus OpenAI-compatible chat-completions API.",
};

const SECTIONS: DocsSectionMeta[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "models", label: "Models" },
  { id: "chat-completions", label: "Chat completions" },
  { id: "streaming", label: "Streaming" },
  { id: "sessions", label: "Sessions" },
  { id: "errors", label: "Errors" },
  { id: "rate-limits", label: "Rate limits" },
];

const BASE_URL = "https://thalamus.aphantic.skinticals.com/v1";

const QUICKSTART_TABS: CodeTab[] = [
  {
    label: "Python",
    lang: "python",
    code: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="th_...",
)

response = client.chat.completions.create(
    model="thalamus-sophon-1.0",
    messages=[{"role": "user", "content": "Say hello."}],
)
print(response.choices[0].message.content)`,
  },
  {
    label: "TypeScript",
    lang: "typescript",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: process.env.THALAMUS_API_KEY,
});

const response = await client.chat.completions.create({
  model: "thalamus-sophon-1.0",
  messages: [{ role: "user", content: "Say hello." }],
});
console.log(response.choices[0].message.content);`,
  },
  {
    label: "curl",
    lang: "bash",
    code: `curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $THALAMUS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "thalamus-sophon-1.0",
    "messages": [{"role": "user", "content": "Say hello."}]
  }'`,
  },
];

const MODELS_TABS: CodeTab[] = [
  {
    label: "curl",
    lang: "bash",
    code: `curl ${BASE_URL}/models \\
  -H "Authorization: Bearer $THALAMUS_API_KEY"`,
  },
  {
    label: "Response",
    lang: "json",
    code: `{
  "object": "list",
  "data": [
    { "id": "thalamus-sophon-1.0", "object": "model", "created": 0, "owned_by": "thalamus" }
  ]
}`,
  },
];

const COMPLETIONS_TABS: CodeTab[] = [
  {
    label: "Request",
    lang: "json",
    code: `{
  "model": "thalamus-sophon-1.0",
  "messages": [{ "role": "user", "content": "Say hello." }],
  "user": "end-user-42"
}`,
  },
  {
    label: "Response",
    lang: "json",
    code: `{
  "id": "chatcmpl-8f2b6c1e-...",
  "object": "chat.completion",
  "created": 1732650000,
  "model": "thalamus-sophon-1.0",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 3,
    "completion_tokens": 7,
    "total_tokens": 10
  }
}`,
  },
];

const STREAMING_TABS: CodeTab[] = [
  {
    label: "Python",
    lang: "python",
    code: `stream = client.chat.completions.create(
    model="thalamus-sophon-1.0",
    messages=[{"role": "user", "content": "Say hello."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
  },
  {
    label: "TypeScript",
    lang: "typescript",
    code: `const stream = await client.chat.completions.create({
  model: "thalamus-sophon-1.0",
  messages: [{ role: "user", content: "Say hello." }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
  },
  {
    label: "curl",
    lang: "bash",
    code: `curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $THALAMUS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "thalamus-sophon-1.0",
    "messages": [{"role": "user", "content": "Say hello."}],
    "stream": true
  }'`,
  },
];

const ERROR_ROWS: string[][] = [
  ["invalid_api_key", "401", "The key is missing, malformed, or revoked."],
  [
    "waitlisted",
    "403",
    "The account hasn't been invited yet. The response includes waitlist_position.",
  ],
  ["model_not_found", "404", "The model field doesn't match thalamus-sophon-1.0."],
  [
    "invalid_request",
    "400",
    "The request body doesn't match the expected shape, or session_id can't be used.",
  ],
  ["lease_held", "409", "Another request for the same end user is already in flight."],
  [
    "rate_limited",
    "429",
    "The account's rate limit was exceeded. Retry after the Retry-After header, in seconds.",
  ],
  ["upstream_unavailable", "503", "The model server didn't respond to this request. Safe to retry."],
  ["model_unavailable", "503", "The model isn't live yet (pre-launch)."],
  ["internal_error", "500", "Something went wrong on our side."],
];

export default function DocsPage() {
  return (
    <DocsShell sections={SECTIONS}>
      <DocsSection id="overview" title="Overview">
        <p>
          Thalamus serves Thalamus Sophon, a model built on a non-transformer architecture, through
          an API compatible with the OpenAI chat-completions shape. Point any OpenAI SDK at the base
          URL below and it works unmodified, streaming included.
        </p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl border border-border bg-surface p-5 text-sm sm:grid-cols-[auto_1fr] sm:items-baseline sm:gap-y-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Base URL</dt>
          <dd className="min-w-0 break-all">
            <Code>{BASE_URL}</Code>
          </dd>
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Model</dt>
          <dd>
            <Code>thalamus-sophon-1.0</Code>
          </dd>
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Status</dt>
          <dd>Private beta. Invited accounts only — see Errors for the waitlisted response.</dd>
        </dl>
      </DocsSection>

      <DocsSection id="quickstart" title="Quickstart">
        <p>Create a key in the console, then call the API exactly as you would call OpenAI's.</p>
        <CodeBlock tabs={QUICKSTART_TABS} />
      </DocsSection>

      <DocsSection id="authentication" title="Authentication">
        <p>
          Create an API key in the console. The raw value is shown once — Thalamus stores only its
          hash. Send it as a bearer token on every request:
        </p>
        <CodeBlock title="Header" tabs={[{ label: "Header", lang: "text", code: "Authorization: Bearer th_..." }]} />
        <p>Keep it secret: anyone holding the key can call the API as your account.</p>
      </DocsSection>

      <DocsSection id="models" title="Models">
        <p>
          <Code>GET /v1/models</Code> lists the models an account may use. Thalamus serves exactly
          one and never routes to a third-party model.
        </p>
        <CodeBlock tabs={MODELS_TABS} />
      </DocsSection>

      <DocsSection id="chat-completions" title="Chat completions">
        <p>
          <Code>POST /v1/chat/completions</Code> follows the OpenAI chat-completions shape. The
          gateway reads these fields and ignores the rest:
        </p>
        <DocsTable
          headers={["Field", "Type", "Required", "Notes"]}
          rows={[
            [<Code key="model">model</Code>, "string", "Yes", "Must be thalamus-sophon-1.0."],
            [
              <Code key="messages">messages</Code>,
              "array",
              "Yes",
              "Non-empty. Each item is { role, content }; content is a string, or an array of { type: \"text\", text } parts.",
            ],
            [<Code key="stream">stream</Code>, "boolean", "—", "Defaults to false. See Streaming."],
            [
              <Code key="user">user</Code>,
              "string",
              "—",
              "A stable per-end-user id. Scopes sessions and model memory to that person — see Sessions.",
            ],
            [
              <Code key="session_id">session_id</Code>,
              "string",
              "—",
              "Explicit session mode. Can also be sent as X-Thalamus-Session-Id — see Sessions.",
            ],
          ]}
        />
        <CodeBlock tabs={COMPLETIONS_TABS} />
        <p>
          <Code>usage.prompt_tokens</Code> and <Code>usage.completion_tokens</Code> are{" "}
          <Code>ceil(characters / 4)</Code>, provided for SDK compatibility — billing and rate
          limits are both in characters. Every response, streamed or not, carries{" "}
          <Code>X-Thalamus-Session-Id</Code>, the id of the session the call resolved to.
        </p>
      </DocsSection>

      <DocsSection id="streaming" title="Streaming">
        <p>
          Set <Code>stream: true</Code> for a standard SSE stream: a role-priming chunk, one{" "}
          <Code>chat.completion.chunk</Code> per delta, a final chunk carrying <Code>usage</Code>,
          then <Code>data: [DONE]</Code>.
        </p>
        <CodeBlock tabs={STREAMING_TABS} />
        <p>
          A failure partway through is sent as <Code>{"data: {\"error\": {...}}"}</Code> before{" "}
          <Code>[DONE]</Code> — the HTTP status is already committed to <Code>200</Code> once the
          stream has started.
        </p>
      </DocsSection>

      <DocsSection id="sessions" title="Sessions">
        <p>
          The model keeps conversation state server-side, so a call only needs the turns it hasn't
          seen yet. An unmodified OpenAI SDK resends the whole <Code>messages</Code> array every
          time, so the gateway resolves that onto a session automatically. Two modes:
        </p>

        <h3 className="mt-2 text-base font-semibold text-fg">Automatic continuation</h3>
        <p>
          Send the full transcript, as the SDK already does. Thalamus hashes the resent messages and
          matches them against the account's open sessions for that end user: a match on the latest
          hash means everything after it is a new turn; a match on the state just before the last
          reply, with no new user message, is a regenerate of that reply; no match — or an earlier
          message changed — starts a fresh session with the full transcript.
        </p>

        <h3 className="mt-2 text-base font-semibold text-fg">Explicit session</h3>
        <p>
          Pass <Code>session_id</Code>, in the body or as <Code>X-Thalamus-Session-Id</Code>, to
          skip that matching. <Code>messages</Code> must then hold only the new turns. The response
          returns the resolved id in the same header either way.
        </p>

        <p>
          Set <Code>user</Code> to a stable identifier for the end user making the call — it scopes
          both session matching and the model's own memory to that person. Omit it only for
          one-off, stateless calls. An API session ends automatically after 30 minutes idle; the
          chat app ends one when the conversation is closed.
        </p>
      </DocsSection>

      <DocsSection id="errors" title="Errors">
        <p>
          Every error follows the OpenAI shape, <Code>{"{ error: { message, type, code } }"}</Code>.
        </p>
        <DocsTable
          headers={["Code", "HTTP status", "Meaning"]}
          rows={ERROR_ROWS.map(([code, status, meaning]) => [<Code key={code}>{code}</Code>, status, meaning])}
        />
      </DocsSection>

      <DocsSection id="rate-limits" title="Rate limits">
        <p>
          The only plan during the free beta is a token bucket: 20 requests per minute per account,
          with a burst of 20. An exceeded limit returns <Code>429</Code> with{" "}
          <Code>Retry-After</Code>. Usage is metered from an account's first request, ahead of paid
          billing.
        </p>
      </DocsSection>
    </DocsShell>
  );
}
