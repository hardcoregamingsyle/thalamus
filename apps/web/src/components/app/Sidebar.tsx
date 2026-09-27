"use client";

import {
  BarChart3,
  BookOpen,
  KeyRound,
  LayoutGrid,
  LogOut,
  MessageCircle,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import type { MeResponse } from "@/lib/types";
import { Skeleton } from "./Skeleton";

type NavItem = { href: string; label: string; icon: LucideIcon };

const PRIMARY: NavItem[] = [
  { href: "/console", label: "Overview", icon: LayoutGrid },
  { href: "/console/keys", label: "API keys", icon: KeyRound },
  { href: "/console/usage", label: "Usage", icon: BarChart3 },
];

const SECONDARY: NavItem[] = [
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition-colors ${
        active ? "bg-surface-strong text-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {item.label}
    </Link>
  );
}

export function Sidebar({
  me,
  loading,
  onNavigate,
}: {
  me: MeResponse | null;
  loading: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", {
        method: "POST",
        headers: { "X-Requested-With": "thalamus" },
      });
    } finally {
      window.location.href = "/";
    }
  }

  const email = me?.user?.email ?? null;
  const initial = email ? email[0]?.toUpperCase() : null;

  return (
    <div className="flex h-full flex-col gap-6 px-4 py-5">
      <div className="px-1">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto">
        <div className="flex flex-col gap-1">
          {PRIMARY.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname === item.href}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          {SECONDARY.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname === item.href}
              onNavigate={onNavigate}
            />
          ))}
          {me?.isAdmin ? (
            <NavLink
              item={{ href: "/console/admin", label: "Admin", icon: ShieldCheck }}
              active={pathname === "/console/admin"}
              onNavigate={onNavigate}
            />
          ) : null}
        </div>
      </nav>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2.5 px-1">
          {loading ? (
            <>
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
            </>
          ) : email ? (
            <>
              <span
                className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-[1.5px]"
                style={{
                  background:
                    "conic-gradient(from 0deg, var(--raw-grad-1), var(--raw-grad-2), var(--raw-grad-3), var(--raw-grad-1))",
                }}
              >
                <span className="flex h-full w-full items-center justify-center rounded-full bg-bg-elevated text-[13px] font-medium text-fg">
                  {initial}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg-muted">{email}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
