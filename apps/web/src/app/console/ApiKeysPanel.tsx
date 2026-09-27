"use client";

import { useState } from "react";
import type { ApiKeyCreated, ApiKeySummary } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeySummary[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);

  async function createKey() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "thalamus" },
        body: JSON.stringify({ name: name || undefined }),
      });
      if (!res.ok) {
        setError("Couldn't create a key. Try again.");
        return;
      }
      const key = (await res.json()) as ApiKeyCreated;
      setCreated(key);
      setCopied(false);
      setName("");
      setKeys((current) => [
        {
          id: key.id,
          name: name || null,
          last4: key.key.slice(-4),
          createdAt: new Date().toISOString(),
          revokedAt: null,
        },
        ...current,
      ]);
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function revokeKey(id: string) {
    if (!window.confirm("Revoke this key? Anything using it will stop working immediately.")) {
      return;
    }
    const res = await fetch(`/api/keys/${id}`, {
      method: "DELETE",
      headers: { "X-Requested-With": "thalamus" },
    });
    if (!res.ok) {
      setError("Couldn't revoke that key. Try again.");
      return;
    }
    setKeys((current) =>
      current.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)),
    );
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select and copy the key manually.");
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="key-name" className="block text-sm font-medium">
            Name (optional)
          </label>
          <input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. local dev"
            className="mt-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void createKey()}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create key"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {created ? (
        <div
          role="group"
          aria-label="New API key"
          className="mt-4 rounded-md border border-border bg-surface p-4"
        >
          <p className="text-sm font-medium">Copy this key now — it won't be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-background px-2 py-1 text-sm break-all">{created.key}</code>
            <button
              type="button"
              onClick={() => void copyKey()}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-background"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="mt-3 text-sm text-muted-foreground hover:underline"
          >
            Done
          </button>
        </div>
      ) : null}

      <table className="mt-6 w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 font-normal">Name</th>
            <th className="py-2 font-normal">Key</th>
            <th className="py-2 font-normal">Created</th>
            <th className="py-2 font-normal">Status</th>
            <th className="py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-4 text-muted-foreground">
                No API keys yet.
              </td>
            </tr>
          ) : (
            keys.map((key) => (
              <tr key={key.id} className="border-b border-border">
                <td className="py-2">{key.name ?? "—"}</td>
                <td className="py-2 font-mono">···· {key.last4}</td>
                <td className="py-2">{formatDate(key.createdAt)}</td>
                <td className="py-2">{key.revokedAt ? "Revoked" : "Active"}</td>
                <td className="py-2 text-right">
                  {key.revokedAt ? null : (
                    <button
                      type="button"
                      onClick={() => void revokeKey(key.id)}
                      className="text-danger hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
