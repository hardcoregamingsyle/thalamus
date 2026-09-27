"use client";

import { useState } from "react";

export function WaitlistJoinButton({ onJoined }: { onJoined: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "X-Requested-With": "thalamus" },
      });
      if (!res.ok) {
        setError("Couldn't join the waitlist. Try again.");
        return;
      }
      onJoined();
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void join()}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join the waitlist"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
