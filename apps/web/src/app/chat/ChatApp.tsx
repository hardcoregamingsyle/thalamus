"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessageRow, ConversationSummary } from "@/lib/types";
import { readChatCompletionStream } from "@/lib/sse-client";

/** Required on every mutating call to the gateway (see docs/architecture.md). */
const MUTATING_HEADERS = { "X-Requested-With": "thalamus" };

async function fetchConversation(
  id: string,
): Promise<{ conversation: ConversationSummary; messages: ChatMessageRow[] } | null> {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as { conversation: ConversationSummary; messages: ChatMessageRow[] };
}

export function ChatApp({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Warm the model server's memory for this user ahead of a first message.
    void fetch("/api/chat/warm", { method: "POST", headers: MUTATING_HEADERS });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function selectConversation(id: string) {
    setError(null);
    const detail = await fetchConversation(id);
    if (!detail) {
      setError("Couldn't load that conversation.");
      return;
    }
    setActiveId(id);
    setMessages(detail.messages);
  }

  function startNewChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
  }

  async function deleteConversation(id: string) {
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    const res = await fetch(`/api/conversations/${id}`, {
      method: "DELETE",
      headers: MUTATING_HEADERS,
    });
    if (!res.ok) {
      setError("Couldn't delete that conversation.");
      return;
    }
    setConversations((current) => current.filter((c) => c.id !== id));
    if (activeId === id) startNewChat();
  }

  async function streamInto(response: Response) {
    setMessages((current) => [
      ...current,
      { id: "pending", role: "assistant", content: "", createdAt: new Date().toISOString() },
    ]);
    setStreaming(true);
    await readChatCompletionStream(response, {
      onDelta: (text) => {
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last && last.id === "pending") {
            next[next.length - 1] = { ...last, content: last.content + text };
          }
          return next;
        });
      },
      onDone: () => setStreaming(false),
      onError: (message) => {
        setStreaming(false);
        setError(message);
      },
    });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || streaming) return;
    setError(null);
    setInput("");

    let conversationId = activeId;
    if (!conversationId) {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...MUTATING_HEADERS },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError("Couldn't start a new conversation.");
        return;
      }
      const { conversation: created } = (await res.json()) as { conversation: ConversationSummary };
      conversationId = created.id;
      setActiveId(created.id);
      setConversations((current) => [created, ...current]);
    }

    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content, createdAt: new Date().toISOString() },
    ]);

    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...MUTATING_HEADERS },
      body: JSON.stringify({ content }),
    });
    await streamInto(res);
  }

  async function regenerate() {
    if (!activeId || streaming) return;
    setError(null);
    setMessages((current) =>
      current[current.length - 1]?.role === "assistant" ? current.slice(0, -1) : current,
    );
    const res = await fetch(`/api/conversations/${activeId}/regenerate`, {
      method: "POST",
      headers: MUTATING_HEADERS,
    });
    await streamInto(res);
  }

  const lastIsAssistant = messages[messages.length - 1]?.role === "assistant";

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] max-w-4xl gap-4 px-4 py-6">
      <aside className="hidden w-56 shrink-0 flex-col gap-2 sm:flex">
        <button
          type="button"
          onClick={startNewChat}
          className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface"
        >
          + New chat
        </button>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                activeId === c.id ? "bg-surface" : "hover:bg-surface"
              }`}
            >
              <button
                type="button"
                onClick={() => void selectConversation(c.id)}
                className="flex-1 truncate text-left"
              >
                {c.title ?? "Untitled"}
              </button>
              <button
                type="button"
                onClick={() => void deleteConversation(c.id)}
                aria-label="Delete conversation"
                className="ml-2 hidden text-muted-foreground hover:text-danger group-hover:inline"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Start a conversation below.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message, index) => (
                <div key={message.id ?? index}>
                  <p className="text-xs font-medium text-muted-foreground">
                    {message.role === "user" ? "You" : "Thalamus"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{message.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {lastIsAssistant && !streaming ? (
          <button
            type="button"
            onClick={() => void regenerate()}
            className="mt-2 self-start text-sm text-muted-foreground hover:underline"
          >
            Regenerate
          </button>
        ) : null}

        <form onSubmit={(event) => void sendMessage(event)} className="mt-4 flex gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <input
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={streaming}
            placeholder="Message Thalamus"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
          >
            {streaming ? "Sending…" : "Send"}
          </button>
        </form>
      </section>
    </div>
  );
}
