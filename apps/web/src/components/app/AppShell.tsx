"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { useMe } from "./useMe";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useMe();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const still = useReducedMotion();

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
        <span className="text-[15px] font-semibold tracking-tight text-fg">Thalamus</span>
      </div>

      <div className="mx-auto flex max-w-[1440px]">
        <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 border-r border-border md:block">
          <Sidebar me={me} loading={loading} />
        </aside>

        <AnimatePresence>
          {drawerOpen ? (
            <>
              <motion.div
                aria-hidden="true"
                onClick={() => setDrawerOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: still ? 0 : 0.2 }}
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
              />
              <motion.aside
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
                initial={still ? false : { x: "-100%" }}
                animate={{ x: 0 }}
                exit={still ? { opacity: 0 } : { x: "-100%" }}
                transition={{ duration: still ? 0.15 : 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-border bg-bg-elevated md:hidden"
              >
                <div className="flex justify-end px-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close menu"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-strong hover:text-fg"
                  >
                    <X className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </button>
                </div>
                <Sidebar me={me} loading={loading} onNavigate={() => setDrawerOpen(false)} />
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
