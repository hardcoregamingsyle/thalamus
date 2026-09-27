"use client";

import { Menu, SquarePen } from "lucide-react";
import { LogoMark } from "@/components/ui/Logo";

export function TopBar({
  onOpenMenu,
  onNewChat,
  showNewChat,
}: {
  onOpenMenu: () => void;
  onNewChat: () => void;
  showNewChat: boolean;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-2 md:hidden">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-strong hover:text-fg"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>
      <LogoMark className="h-6 w-6" />
      {showNewChat ? (
        <button
          type="button"
          onClick={onNewChat}
          aria-label="New chat"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-strong hover:text-fg"
        >
          <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
      ) : (
        <div className="h-9 w-9" />
      )}
    </div>
  );
}
