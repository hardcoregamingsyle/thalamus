"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { LockedNotice } from "@/components/app/LockedNotice";
import { Skeleton } from "@/components/app/Skeleton";
import { useMe } from "@/components/app/useMe";
import type { ApiKeyCreated, ApiKeySummary } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type CreateState = "idle" | "pending" | "created";

export default function KeysPage() {
  const { me, loading: meLoading } = useMe();
  const account = me?.account ?? null;
  const hasAccess = account?.status === "invited" || account?.status === "active";

  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createState, setCreateState] = useState<CreateState>("idle");
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      if (!res.ok) {
        setListError("Couldn't load your API keys.");
        return;
      }
      const data = (await res.json()) as { keys: ApiKeySummary[] };
      setKeys(data.keys);
    } catch {
      setListError("Couldn't reach Thalamus.");
    }
  }, []);

  useEffect(() => {
    if (hasAccess) void loadKeys();
  }, [hasAccess, loadKeys]);

  function openCreate() {
    setName("");
    setCreateState("idle");
    setCreateError(null);
    setCreated(null);
    setCopied(false);
    setCreateOpen(true);
  }

  async function createKey() {
    setCreateState("pending");
    setCreateError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "thalamus" },
        body: JSON.stringify({ name: name.trim() || undefined }),
      });
      if (!res.ok) {
        setCreateError("Couldn't create a key. Try again.");
        setCreateState("idle");
        return;
      }
      const key = (await res.json()) as ApiKeyCreated;
      setCreated(key);
      setCreateState("created");
      setKeys((current) => [
        { id: key.id, name: key.name, last4: key.last4, createdAt: key.createdAt, revokedAt: null },
        ...(current ?? []),
      ]);
    } catch {
      setCreateError("Couldn't reach Thalamus. Try again.");
      setCreateState("idle");
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setCreateError("Couldn't copy — select and copy the key manually.");
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/keys/${revokeTarget.id}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "thalamus" },
      });
      if (res.ok) {
        const revokedId = revokeTarget.id;
        setKeys((current) =>
          (current ?? []).map((k) =>
            k.id === revokedId ? { ...k, revokedAt: new Date().toISOString() } : k,
          ),
        );
        setRevokeTarget(null);
      } else {
        setListError("Couldn't revoke that key. Try again.");
      }
    } catch {
      setListError("Couldn't reach Thalamus. Try again.");
    } finally {
      setRevoking(false);
    }
  }

  if (meLoading) {
    return (
      <div>
        <PageHeader title="API keys" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div>
        <PageHeader title="API keys" />
        <LockedNotice message="API keys unlock once your account is invited off the waitlist." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Keys authenticate requests to the Thalamus API."
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Create key
          </Button>
        }
      />

      {listError ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          {listError}
        </p>
      ) : null}

      {keys === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          message="No API keys yet. Create one to start calling the API."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-fg-subtle">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Key</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 text-fg">{key.name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-[13px] text-fg-muted">
                    th_••••{key.last4}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{formatDate(key.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        key.revokedAt
                          ? "bg-surface-strong text-fg-subtle"
                          : "bg-success/10 text-success"
                      }`}
                    >
                      {key.revokedAt ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {key.revokedAt ? null : (
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(key)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                        aria-label={`Revoke ${key.name ?? "key"}`}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={createState === "created" ? "Key created" : "Create an API key"}
        description={
          createState === "created" ? undefined : "Give it a name so you can tell keys apart later."
        }
      >
        {createState === "created" && created ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">
                {created.key}
              </code>
              <button
                type="button"
                onClick={() => void copyKey()}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-fg-muted transition-colors hover:bg-surface-strong hover:text-fg"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-[13px] text-danger">You won&apos;t be able to see this key again.</p>
            <Button onClick={() => setCreateOpen(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createKey();
            }}
            className="flex flex-col gap-4"
          >
            <Input
              label="Name"
              placeholder="e.g. local dev"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            {createError ? (
              <p role="alert" className="text-sm text-danger">
                {createError}
              </p>
            ) : null}
            <Button type="submit" disabled={createState === "pending"} className="w-full">
              {createState === "pending" ? "Creating…" : "Create key"}
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revoke this key?"
        description={
          revokeTarget
            ? `Anything using "${revokeTarget.name ?? `th_••••${revokeTarget.last4}`}" will stop working immediately.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmRevoke()} disabled={revoking}>
            {revoking ? "Revoking…" : "Revoke key"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
