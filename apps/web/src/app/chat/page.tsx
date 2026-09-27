"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe } from "@/lib/me";
import { AccountStatus, hasAccess } from "@/components/AccountStatus";
import type { ConversationSummary, MeAccount } from "@/lib/types";
import { ChatApp } from "./ChatApp";

type LoadState = "loading" | "signed-out" | "no-access" | "ready";

async function loadConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations");
  if (!res.ok) return [];
  const data = (await res.json()) as { conversations: ConversationSummary[] };
  return data.conversations;
}

export default function ChatPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [account, setAccount] = useState<MeAccount | null>(null);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.ok || !me.data.user) {
      setState("signed-out");
      router.replace("/auth");
      return;
    }

    setAccount(me.data.account);
    setWaitlistPosition(me.data.waitlistPosition);

    if (!hasAccess(me.data.account)) {
      setState("no-access");
      return;
    }

    setConversations(await loadConversations());
    setState("ready");
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading" || state === "signed-out") {
    return <div className="mx-auto max-w-2xl px-4 py-12" />;
  }

  if (state === "no-access") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <div className="mt-8">
          <AccountStatus account={account} waitlistPosition={waitlistPosition} onJoined={load} />
        </div>
      </div>
    );
  }

  return <ChatApp initialConversations={conversations} />;
}
