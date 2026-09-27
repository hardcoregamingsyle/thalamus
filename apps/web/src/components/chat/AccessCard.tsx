"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/Logo";
import { joinWaitlist } from "@/lib/chat-api";
import type { MeAccount } from "@/lib/types";

/**
 * The calm "you can't chat yet" card: no account, waitlisted, or suspended.
 * Mirrors the old AccountStatus component's cases but with its own copy and
 * without importing it (it is being deleted) or WaitlistJoinButton.
 */
export function AccessCard({
  account,
  waitlistPosition,
  onJoined,
}: {
  account: MeAccount | null;
  waitlistPosition: number | null;
  onJoined: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setPending(true);
    setError(null);
    const result = await joinWaitlist();
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onJoined();
  }

  const suspended = account?.status === "suspended";
  const waitlisted = account?.status === "waitlisted";

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-surface px-8 py-10 text-center">
        <LogoMark className="mx-auto h-9 w-9" />
        {suspended ? (
          <>
            <h1 className="mt-5 text-lg font-semibold tracking-tight text-fg">
              This account is suspended.
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
              Contact support if you think this is a mistake.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-lg font-semibold tracking-tight text-fg">
              Chat opens when you&apos;re invited.
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
              {waitlisted
                ? typeof waitlistPosition === "number"
                  ? `You're #${waitlistPosition} on the waitlist.`
                  : "You're on the waitlist."
                : "Join the waitlist to get access."}
            </p>
            {!waitlisted ? (
              <Button
                onClick={() => void join()}
                disabled={pending}
                className="mt-6 w-full justify-center"
              >
                {pending ? "Joining…" : "Join the waitlist"}
              </Button>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
