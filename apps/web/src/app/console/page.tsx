"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/app/PageHeader";
import { Skeleton } from "@/components/app/Skeleton";
import { useMe } from "@/components/app/useMe";

export default function ConsolePage() {
  const { me, loading, reload } = useMe();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function join() {
    setJoining(true);
    setError(null);
    try {
      const response = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "X-Requested-With": "thalamus" },
      });
      if (!response.ok) throw new Error("join_failed");
      reload();
    } catch {
      setError("Couldn’t join the waitlist. Please try again.");
    } finally {
      setJoining(false);
    }
  }
  if (loading)
    return (
      <>
        <PageHeader title="Your account" />
        <Skeleton className="h-64" />
      </>
    );
  const invited = me?.account?.status === "invited";
  return (
    <div>
      <PageHeader title="Your account" description="NAMELESS is currently training." />
      <div className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-surface px-6 py-20 text-center">
        <span className="flex h-32 w-32 items-center justify-center rounded-full border border-border-strong bg-bg-elevated text-3xl font-semibold text-fg">
          {invited
            ? "You’re in"
            : typeof me?.waitlistPosition === "number"
              ? `#${me.waitlistPosition}`
              : "—"}
        </span>
        <h2 className="text-xl font-semibold text-fg">
          {invited
            ? "Your early-access slot is reserved"
            : me?.account
              ? "You’re on the list"
              : "Join the waitlist"}
        </h2>
        <p className="max-w-md text-[15px] leading-relaxed text-fg-muted">
          {invited
            ? "Your invitation is confirmed. The model is still training; generation will open separately."
            : "We’ll email you when an early-access slot becomes available. No payment is needed to join."}
        </p>
        {!me?.account && (
          <Button disabled={joining} onClick={() => void join()}>
            {joining ? "Joining…" : "Join the waitlist"}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
