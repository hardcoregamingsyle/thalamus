"use client";

import { Inbox } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Skeleton } from "@/components/app/Skeleton";
import { useMe } from "@/components/app/useMe";
import type { AdminWaitlistRow } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminPage() {
  const { me, loading: meLoading } = useMe();
  const router = useRouter();
  const isAdmin = me?.isAdmin ?? false;

  const [rows, setRows] = useState<AdminWaitlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  useEffect(() => {
    if (!meLoading && !isAdmin) router.replace("/console");
  }, [meLoading, isAdmin, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/waitlist");
      if (!res.ok) {
        setError("Couldn't load the waitlist.");
        return;
      }
      const data = (await res.json()) as { waitlist: AdminWaitlistRow[] };
      setRows(data.waitlist);
    } catch {
      setError("Couldn't reach Thalamus.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function invite(row: AdminWaitlistRow) {
    setInvitingId(row.accountId);
    setError(null);
    const previous = rows;
    setRows((current) => (current ?? []).filter((r) => r.accountId !== row.accountId));
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "thalamus" },
        body: JSON.stringify({ accountId: row.accountId }),
      });
      if (!res.ok) {
        setRows(previous);
        setError(`Couldn't invite ${row.email}. Try again.`);
      }
    } catch {
      setRows(previous);
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setInvitingId(null);
    }
  }

  if (meLoading || !isAdmin) {
    return (
      <div>
        <PageHeader title="Admin" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Admin" description="Invite accounts off the waitlist, in order." />

      {error ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} message="The waitlist is empty." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-fg-subtle">
                <th className="px-4 py-2.5 font-medium">Position</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.accountId} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 text-fg-muted">{row.position}</td>
                  <td className="px-4 py-3 text-fg">{row.email}</td>
                  <td className="px-4 py-3 text-fg-muted">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void invite(row)}
                      disabled={invitingId === row.accountId}
                    >
                      {invitingId === row.accountId ? "Inviting…" : "Invite"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
