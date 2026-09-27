"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CodeBlock, type CodeTab } from "@/components/ui/CodeBlock";
import { PageHeader } from "@/components/app/PageHeader";
import { Skeleton } from "@/components/app/Skeleton";
import { useMe } from "@/components/app/useMe";
import type { UsageRow } from "@/lib/types";

const BASE_URL = "https://thalamus.aphantic.skinticals.com/v1";
const MODEL = "thalamus-sophon-1.0";

const QUICKSTART_TABS: CodeTab[] = [
  {
    label: "Python",
    lang: "python",
    code: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="th_...",
)

completion = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(completion.choices[0].message.content)`,
  },
  {
    label: "TypeScript",
    lang: "typescript",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.THALAMUS_API_KEY,
  baseURL: "${BASE_URL}",
});

const completion = await client.chat.completions.create({
  model: "${MODEL}",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(completion.choices[0].message.content);`,
  },
  {
    label: "curl",
    lang: "bash",
    code: `curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer th_..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${MODEL}","messages":[{"role":"user","content":"Hello"}]}'`,
  },
];

function sumUsage(rows: UsageRow[]): { requests: number; charsOut: number } {
  return rows.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      charsOut: acc.charsOut + row.charsOut,
    }),
    { requests: 0, charsOut: 0 },
  );
}

export default function ConsolePage() {
  const { me, loading: meLoading, reload } = useMe();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);

  const account = me?.account ?? null;
  const hasAccess = account?.status === "invited" || account?.status === "active";

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage?days=30");
      if (!res.ok) return;
      const data = (await res.json()) as { days: UsageRow[] };
      setUsage(data.days);
    } catch {
      // Leave usage unset — the stat tiles keep their loading state.
    }
  }, []);

  useEffect(() => {
    if (hasAccess) void loadUsage();
  }, [hasAccess, loadUsage]);

  async function joinWaitlist() {
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "X-Requested-With": "thalamus" },
      });
      if (!res.ok) {
        setJoinError("Couldn't join the waitlist. Try again.");
        return;
      }
      reload();
    } catch {
      setJoinError("Couldn't reach Thalamus. Try again.");
    } finally {
      setJoining(false);
    }
  }

  if (meLoading) {
    return (
      <div>
        <PageHeader title="Overview" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div>
        <PageHeader title="Overview" description="Thalamus is in private beta." />
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-border bg-surface px-6 py-16 text-center">
          <h2 className="text-lg font-semibold tracking-tight text-fg">Join the waitlist</h2>
          <p className="max-w-sm text-[15px] text-fg-muted">
            Accounts are invited in the order they joined.
          </p>
          <Button onClick={() => void joinWaitlist()} disabled={joining}>
            {joining ? "Joining…" : "Join the waitlist"}
          </Button>
          {joinError ? (
            <p role="alert" className="text-sm text-danger">
              {joinError}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (account.status === "waitlisted") {
    return (
      <div>
        <PageHeader title="Overview" />
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-surface px-6 py-20 text-center">
          <div className="relative h-40 w-40">
            <div
              aria-hidden="true"
              className="absolute inset-0 animate-[spin_9s_linear_infinite] rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--raw-grad-1), var(--raw-grad-2), var(--raw-grad-3), var(--raw-grad-1))",
                WebkitMask:
                  "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
              }}
            />
            <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-bg-elevated">
              <span className="text-4xl font-semibold tracking-tight text-fg">
                {typeof me?.waitlistPosition === "number" ? `#${me.waitlistPosition}` : "—"}
              </span>
            </div>
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-fg">You&apos;re on the list</h2>
          <p className="max-w-sm text-[15px] text-fg-muted">
            Accounts are invited in the order they joined.
          </p>
        </div>
      </div>
    );
  }

  if (account.status === "suspended") {
    return (
      <div>
        <PageHeader title="Overview" />
        <div className="rounded-3xl border border-border bg-surface px-6 py-16 text-center">
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            This account is suspended
          </h2>
          <p className="mt-2 text-[15px] text-fg-muted">
            Contact support if you think this is a mistake.
          </p>
        </div>
      </div>
    );
  }

  const totals = usage ? sumUsage(usage) : null;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Keys, usage and a quickstart for the Thalamus API."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">
            Requests · 30 days
          </p>
          {totals ? (
            <p className="mt-2 text-3xl font-semibold tracking-tight text-fg">
              {totals.requests.toLocaleString()}
            </p>
          ) : (
            <Skeleton className="mt-2 h-9 w-20" />
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">
            Characters out · 30 days
          </p>
          {totals ? (
            <p className="mt-2 text-3xl font-semibold tracking-tight text-fg">
              {totals.charsOut.toLocaleString()}
            </p>
          ) : (
            <Skeleton className="mt-2 h-9 w-24" />
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">API keys</h2>
          <p className="mt-1 text-sm text-fg-muted">Create a key to start calling the API.</p>
        </div>
        <ButtonLink href="/console/keys" variant="secondary" size="sm">
          <KeyRound className="h-4 w-4" strokeWidth={1.75} />
          Create an API key
        </ButtonLink>
      </div>

      <div className="mt-8">
        <h2 className="text-[15px] font-semibold text-fg">Quickstart</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Point any OpenAI SDK at the base URL below with a key from above.
        </p>
        <CodeBlock tabs={QUICKSTART_TABS} className="mt-3" />
      </div>
    </div>
  );
}
