"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminWaitlistRow } from "@/lib/types";
import { fetchMe } from "@/lib/me";

type LoadState = "loading" | "forbidden" | "ready";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<AdminWaitlistRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.ok || !me.data.user) {
      router.replace("/auth");
      return;
    }
    if (!me.data.isAdmin) {
      setState("forbidden");
      return;
    }

    const res = await fetch("/api/admin/waitlist");
    if (!res.ok) {
      setError("Couldn't load the waitlist. Try again.");
      setState("ready");
      return;
    }
    const data = (await res.json()) as { waitlist: AdminWaitlistRow[] };
    setRows(data.waitlist);
    setState("ready");
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(accountId: string) {
    setInvitingId(accountId);
    setError(null);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "thalamus" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) {
        setError("Couldn't invite that account. Try again.");
        return;
      }
      setRows((current) => current.filter((row) => row.accountId !== accountId));
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setInvitingId(null);
    }
  }

  if (state === "loading") {
    return <div className="mx-auto max-w-4xl px-4 py-12" />;
  }

  if (state === "forbidden") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          This page is only available to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Waitlist</h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <table className="mt-6 w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 font-normal">Position</th>
            <th className="py-2 font-normal">Email</th>
            <th className="py-2 font-normal">Joined</th>
            <th className="py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-4 text-muted-foreground">
                The waitlist is empty.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.accountId} className="border-b border-border">
                <td className="py-2">{row.position}</td>
                <td className="py-2">{row.email}</td>
                <td className="py-2">{formatDate(row.createdAt)}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void invite(row.accountId)}
                    disabled={invitingId === row.accountId}
                    className="rounded-md border border-border px-3 py-1 hover:bg-surface disabled:opacity-60"
                  >
                    {invitingId === row.accountId ? "Inviting…" : "Invite"}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
