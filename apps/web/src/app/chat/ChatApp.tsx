"use client";

import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { EASE_OUT } from "@/components/ui/Reveal";
import {
  createConversation,
  deleteConversation,
  fetchConversation,
  isAbortError,
  listConversations,
  postMessage,
  postRegenerate,
  warmChat,
} from "@/lib/chat-api";
import type { NoticeKind, TimelineItem } from "@/lib/chat-types";
import { fetchMe } from "@/lib/me";
import { readChatCompletionStream } from "@/lib/sse-client";
import type { ConversationSummary, MeAccount, MeUser } from "@/lib/types";
import { AccessCard } from "@/components/chat/AccessCard";
import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { Sidebar } from "@/components/chat/Sidebar";
import { Timeline } from "@/components/chat/Timeline";
import { TopBar } from "@/components/chat/TopBar";

type Phase = "loading" | "signed-out" | "denied" | "ready";
type GenerationMode = { type: "message"; content: string } | { type: "regenerate" };

function hasAccess(account: MeAccount | null): boolean {
  return account?.status === "invited" || account?.status === "active";
}

export function ChatApp() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<MeUser | null>(null);
  const [account, setAccount] = useState<MeAccount | null>(null);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sidebarNotice, setSidebarNotice] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const skipScrollAnimationRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  async function load() {
    const me = await fetchMe();
    if (!me.ok || !me.data.user) {
      setPhase("signed-out");
      router.replace("/auth");
      return;
    }

    setUser(me.data.user);
    setAccount(me.data.account);
    setWaitlistPosition(me.data.waitlistPosition);

    if (!hasAccess(me.data.account)) {
      setPhase("denied");
      return;
    }

    setConversations(await listConversations());
    setPhase("ready");

    const initial = new URLSearchParams(window.location.search).get("c");
    if (initial) await openConversation(initial, false);
  }

  useEffect(() => {
    // Mount only: this reads the URL's initial `?c=` once and establishes
    // the session. Later navigation goes through the handlers below, which
    // close over fresh state on every render.
    void load();
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: skipScrollAnimationRef.current ? "auto" : "smooth",
    });
    skipScrollAnimationRef.current = false;
  }, [items]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 96;
    atBottomRef.current = atBottom;
    setShowJump(!atBottom);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  async function openConversation(id: string | null, push: boolean) {
    setMobileNavOpen(false);
    setComposerError(null);
    abortRef.current?.abort();
    setStreaming(false);

    if (!id) {
      setActiveId(null);
      setItems([]);
      setInput("");
      atBottomRef.current = true;
      setShowJump(false);
      if (push) window.history.pushState(null, "", "/chat");
      return;
    }

    const detail = await fetchConversation(id);
    if (!detail) {
      setActiveId(null);
      setItems([]);
      if (push) window.history.pushState(null, "", "/chat");
      return;
    }

    skipScrollAnimationRef.current = true;
    atBottomRef.current = true;
    setShowJump(false);
    setActiveId(id);
    setItems(detail.messages.map((message) => ({ kind: "message" as const, message })));
    setInput("");
    if (push) window.history.pushState(null, "", `/chat?c=${id}`);
    warmChat(id);
  }

  async function removeConversation(id: string) {
    const result = await deleteConversation(id);
    if (!result.ok) {
      setSidebarNotice(result.error);
      setTimeout(() => setSidebarNotice(null), 4000);
      return;
    }
    setConversations((cur) => cur.filter((c) => c.id !== id));
    if (activeIdRef.current === id) await openConversation(null, true);
  }

  function touchConversation(id: string) {
    setConversations((cur) => {
      const idx = cur.findIndex((c) => c.id === id);
      const row = cur[idx];
      if (!row) return cur;
      const next = cur.slice();
      next.splice(idx, 1);
      next.unshift({ ...row, updatedAt: new Date().toISOString() });
      return next;
    });
  }

  function appendNotice(kind: NoticeKind, text: string, onRetry?: () => void) {
    setItems((cur) => [
      ...cur,
      { kind: "notice", id: crypto.randomUUID(), noticeKind: kind, text, onRetry },
    ]);
  }

  async function streamAssistantReply(conversationId: string, res: Response, mode: GenerationMode) {
    const pendingId = crypto.randomUUID();
    setItems((cur) => [
      ...cur,
      {
        kind: "message",
        message: {
          id: pendingId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    await readChatCompletionStream(res, {
      onDelta: (text) => {
        setItems((cur) =>
          cur.map((item) =>
            item.kind === "message" && item.message.id === pendingId
              ? { ...item, message: { ...item.message, content: item.message.content + text } }
              : item,
          ),
        );
      },
      onDone: () => {
        setStreaming(false);
        abortRef.current = null;
        touchConversation(conversationId);
      },
      onAbort: () => {
        setStreaming(false);
        abortRef.current = null;
        touchConversation(conversationId);
      },
      onError: (info) => {
        setStreaming(false);
        abortRef.current = null;
        // Drop the pending bubble only if nothing streamed into it yet —
        // a partial reply followed by a dropped connection is still worth
        // keeping on screen.
        setItems((cur) =>
          cur.filter(
            (item) =>
              !(
                item.kind === "message" &&
                item.message.id === pendingId &&
                item.message.content === ""
              ),
          ),
        );

        if (info.code === "model_unavailable") {
          // conversations.ts checks `modelServerConfigured` before it ever
          // inserts the user's message, so nothing was saved here.
          appendNotice(
            "model_unavailable",
            "Thalamus Sophon isn't available yet. Try again later.",
          );
          return;
        }

        // A "stream"-stage failure means the 200 response had already
        // started, which only happens after the user message is inserted —
        // retrying a `message` send verbatim would duplicate it, so redo it
        // as a regenerate instead.
        const retryMode: GenerationMode =
          info.stage === "stream" && mode.type === "message" ? { type: "regenerate" } : mode;
        appendNotice("error", info.message, () => void runGeneration(conversationId, retryMode));
      },
    });
  }

  async function runGeneration(conversationId: string, mode: GenerationMode) {
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    let res: Response;
    try {
      res =
        mode.type === "message"
          ? await postMessage(conversationId, mode.content, controller.signal)
          : await postRegenerate(conversationId, controller.signal);
    } catch (err) {
      setStreaming(false);
      abortRef.current = null;
      if (!isAbortError(err)) {
        appendNotice(
          "error",
          "Couldn't reach Thalamus. Try again.",
          () => void runGeneration(conversationId, mode),
        );
      }
      return;
    }

    await streamAssistantReply(conversationId, res, mode);
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    setComposerError(null);

    let conversationId = activeIdRef.current;
    if (!conversationId) {
      const title = content.length > 48 ? `${content.slice(0, 48).trimEnd()}…` : content;
      const created = await createConversation(title);
      if (!created.ok) {
        setInput(content);
        setComposerError(created.error);
        return;
      }
      conversationId = created.conversation.id;
      setActiveId(conversationId);
      setConversations((cur) => [created.conversation, ...cur]);
      atBottomRef.current = true;
      window.history.pushState(null, "", `/chat?c=${conversationId}`);
      warmChat(conversationId);
    }

    setItems((cur) => [
      ...cur,
      {
        kind: "message",
        message: {
          id: crypto.randomUUID(),
          role: "user",
          content,
          createdAt: new Date().toISOString(),
        },
      },
    ]);
    touchConversation(conversationId);
    await runGeneration(conversationId, { type: "message", content });
  }

  async function regenerateLast() {
    const id = activeIdRef.current;
    if (!id || streaming) return;
    setItems((cur) => {
      const last = cur[cur.length - 1];
      return last?.kind === "message" && last.message.role === "assistant" ? cur.slice(0, -1) : cur;
    });
    await runGeneration(id, { type: "regenerate" });
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  if (phase === "loading" || phase === "signed-out") {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <LogoMark className="h-8 w-8 opacity-40" />
      </div>
    );
  }

  const canChat = phase === "ready";

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <aside className="hidden w-[264px] shrink-0 border-r border-border md:flex md:flex-col">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => void openConversation(id, true)}
          onNewChat={() => void openConversation(null, true)}
          onDelete={(id) => void removeConversation(id)}
          readOnly={!canChat}
          user={user}
          notice={sidebarNotice}
        />
      </aside>

      <AnimatePresence>
        {mobileNavOpen ? (
          <>
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.div
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Conversations"
              className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-border bg-bg-elevated md:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease: EASE_OUT }}
            >
              <Sidebar
                conversations={conversations}
                activeId={activeId}
                onSelect={(id) => void openConversation(id, true)}
                onNewChat={() => void openConversation(null, true)}
                onDelete={(id) => void removeConversation(id)}
                readOnly={!canChat}
                user={user}
                notice={sidebarNotice}
              />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenMenu={() => setMobileNavOpen(true)}
          onNewChat={() => void openConversation(null, true)}
          showNewChat={canChat}
        />

        {phase === "denied" ? (
          <AccessCard
            account={account}
            waitlistPosition={waitlistPosition}
            onJoined={() => void load()}
          />
        ) : !activeId ? (
          <EmptyState
            value={input}
            onChange={setInput}
            onSend={() => void sendMessage()}
            onStop={stopGenerating}
            streaming={streaming}
            disabled={false}
            error={composerError}
          />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Timeline
              items={items}
              streaming={streaming}
              onRegenerate={() => void regenerateLast()}
              scrollRef={scrollRef}
              onScroll={handleScroll}
            />
            <AnimatePresence>
              {showJump ? (
                <motion.button
                  type="button"
                  onClick={jumpToLatest}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-strong bg-bg-elevated px-4 py-1.5 text-xs font-medium text-fg shadow-lg transition-colors hover:bg-surface-strong"
                >
                  <ArrowDown className="h-3 w-3" />
                  Jump to latest
                </motion.button>
              ) : null}
            </AnimatePresence>
            <div className="bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-4 pt-6">
              <div className="mx-auto w-full max-w-3xl">
                <Composer
                  value={input}
                  onChange={setInput}
                  onSend={() => void sendMessage()}
                  onStop={stopGenerating}
                  streaming={streaming}
                  disabled={false}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
