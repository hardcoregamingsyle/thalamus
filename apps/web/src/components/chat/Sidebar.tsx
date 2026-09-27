"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, SquarePen, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import type { ConversationSummary, MeUser } from "@/lib/types";

interface Group {
  label: string;
  items: ConversationSummary[];
}

function groupConversations(conversations: ConversationSummary[]): Group[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000;

  const today: ConversationSummary[] = [];
  const week: ConversationSummary[] = [];
  const older: ConversationSummary[] = [];

  for (const c of conversations) {
    const updated = new Date(c.updatedAt).getTime();
    if (updated >= startOfToday.getTime()) today.push(c);
    else if (updated >= weekAgo) week.push(c);
    else older.push(c);
  }

  return [
    { label: "Today", items: today },
    { label: "Previous 7 days", items: week },
    { label: "Older", items: older },
  ].filter((g) => g.items.length > 0);
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className={`group flex items-center rounded-xl px-2.5 py-2 text-sm transition-colors ${
        active ? "bg-surface-strong text-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
      }`}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left">
        {conversation.title ?? "New chat"}
      </button>
      {confirming ? (
        <div className="ml-1 flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            aria-label="Confirm delete"
            title="Confirm delete"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-danger hover:bg-danger/10"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            aria-label="Cancel delete"
            title="Cancel"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-strong hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete conversation"
          title="Delete conversation"
          className="ml-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-strong hover:text-danger group-hover:inline-flex"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </motion.div>
  );
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  readOnly,
  user,
  notice,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  readOnly: boolean;
  user: MeUser | null;
  notice?: string | null;
}) {
  const groups = groupConversations(conversations);
  const initial = user?.email?.trim()?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="px-1 pb-2">
        <Logo />
      </div>

      {!readOnly ? (
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border-strong px-3.5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-strong"
        >
          <SquarePen className="h-4 w-4" strokeWidth={1.75} />
          New chat
        </button>
      ) : null}

      {notice ? (
        <p role="alert" className="px-2 pt-2 text-xs text-danger">
          {notice}
        </p>
      ) : null}

      {!readOnly ? (
        <nav className="-mx-1 mt-2 flex-1 space-y-4 overflow-y-auto px-1">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                {group.label}
              </p>
              <div className="mt-1 space-y-0.5">
                <AnimatePresence initial={false}>
                  {group.items.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
                      active={c.id === activeId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </nav>
      ) : (
        <div className="flex-1" />
      )}

      <div className="border-t border-border pt-3">
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-strong text-xs font-medium text-fg">
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{user?.email}</span>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <Link
            href="/console"
            className="rounded-md text-sm text-fg-muted transition-colors hover:text-fg"
          >
            Console
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
