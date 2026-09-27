"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchMe } from "@/lib/me";
import type { MeUser } from "@/lib/types";
import { SignOutButton } from "./SignOutButton";

export function Header() {
  const [user, setUser] = useState<MeUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((me) => {
      if (!cancelled && me.ok) setUser(me.data.user);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight no-underline">
          Thalamus
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link href="/docs" className="no-underline hover:underline">
            Docs
          </Link>
          {user ? (
            <>
              <Link href="/console" className="no-underline hover:underline">
                Console
              </Link>
              <Link href="/chat" className="no-underline hover:underline">
                Chat
              </Link>
              <span className="hidden text-muted-foreground sm:inline">{user.email}</span>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/auth"
              className="rounded-md bg-accent px-3 py-1.5 text-accent-foreground no-underline hover:opacity-90"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
