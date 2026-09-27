"use client";

import { useState } from "react";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/signout", {
        method: "POST",
        headers: { "X-Requested-With": "thalamus" },
      });
    } finally {
      // Full reload so every server-rendered surface (header included) picks
      // up the cleared session cookie.
      window.location.href = "/";
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
