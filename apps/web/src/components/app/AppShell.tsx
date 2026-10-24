"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { useMe } from "./useMe";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useMe();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (drawerOpen) dialog?.showModal();
    else dialog?.close();
  }, [drawerOpen]);

  return (
    <div className="min-h-dvh bg-bg">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-strong hover:text-fg"
        >
          <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        <LogoMark className="h-5 w-5" />
        <span className="text-[15px] font-semibold tracking-tight text-fg">NAMELESS</span>
      </div>

      <div className="mx-auto flex max-w-[1440px]">
        <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 border-r border-border md:block">
          <Sidebar me={me} loading={loading} />
        </aside>

        <dialog
          ref={dialogRef}
          onCancel={() => setDrawerOpen(false)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              setDrawerOpen(false);
          }}
          aria-label="Navigation"
          className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[280px] max-w-[85vw] border-r border-border bg-bg-elevated text-fg backdrop:bg-black/50"
        >
          <div className="flex justify-end px-3 pt-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-strong hover:text-fg"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="h-[calc(100%-48px)]">
            <Sidebar me={me} loading={loading} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </dialog>

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
