"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchMe } from "@/lib/me";
import { AccountStatus, hasAccess } from "@/components/AccountStatus";
import type { ApiKeySummary, MeAccount, UsageRow } from "@/lib/types";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { UsageSection } from "./UsageSection";
import { Quickstart } from "./Quickstart";

type LoadState = "loading" | "signed-out" | "no-access" | "ready";

async function loadKeys(): Promise<ApiKeySummary[]> {
  const res = await fetch("/api/keys");
  if (!res.ok) return [];
  const data = (await res.json()) as { keys: ApiKeySummary[] };
  return data.keys;
}

async function loadUsage(): Promise<UsageRow[]> {
  const res = await fetch("/api/usage?days=30");
  if (!res.ok) return [];
  const data = (await res.json()) as { days: UsageRow[] };
  return data.days;
}

export default function ConsolePage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [account, setAccount] = useState<MeAccount | null>(null);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.ok || !me.data.user) {
      setState("signed-out");
      router.replace("/auth");
      return;
    }

    setAccount(me.data.account);
    setWaitlistPosition(me.data.waitlistPosition);
    setIsAdmin(me.data.isAdmin);

    if (!hasAccess(me.data.account)) {
      setState("no-access");
      return;
    }

    const [loadedKeys, loadedUsage] = await Promise.all([loadKeys(), loadUsage()]);
    setKeys(loadedKeys);
    setUsage(loadedUsage);
    setState("ready");
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading" || state === "signed-out") {
    return <div className="mx-auto max-w-4xl px-4 py-12" />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Console</h1>
        {isAdmin ? (
          <Link href="/console/admin" className="text-sm no-underline hover:underline">
            Admin
          </Link>
        ) : null}
      </div>

      {state === "no-access" ? (
        <div className="mt-8">
          <AccountStatus account={account} waitlistPosition={waitlistPosition} onJoined={load} />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-12">
          <section>
            <h2 className="font-medium">API keys</h2>
            <ApiKeysPanel initialKeys={keys} />
          </section>

          <section>
            <h2 className="font-medium">Usage — last 30 days</h2>
            <UsageSection rows={usage} />
          </section>

          <section>
            <h2 className="font-medium">Quickstart</h2>
            <Quickstart />
          </section>
        </div>
      )}
    </div>
  );
}
