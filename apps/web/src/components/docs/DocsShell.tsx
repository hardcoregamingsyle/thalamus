"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface DocsSectionMeta {
  id: string;
  label: string;
}

// Sticky left nav with active-section highlighting (IntersectionObserver over
// each section's heading), collapsing to a top "On this page" select below md.
export function DocsShell({ sections, children }: { sections: DocsSectionMeta[]; children: ReactNode }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // Biases toward the section whose heading has just crossed below the
      // fixed nav, so "active" tracks what's actually visible up top.
      { rootMargin: "-112px 0px -70% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="pt-16">
      <div className="sticky top-16 z-10 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur-xl md:hidden">
        <label className="sr-only" htmlFor="docs-jump">
          On this page
        </label>
        <select
          id="docs-jump"
          value={active}
          onChange={(e) => jumpTo(e.target.value)}
          className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-fg"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mx-auto flex max-w-6xl gap-12 px-4 sm:px-6 lg:gap-16">
        <aside className="hidden w-52 shrink-0 md:block">
          <nav aria-label="On this page" className="sticky top-24 flex flex-col gap-0.5 py-12 text-sm">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                aria-current={active === s.id ? "location" : undefined}
                className={`rounded-lg px-3 py-1.5 transition-colors duration-150 ${
                  active === s.id ? "bg-surface-strong text-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl flex-1 py-12">{children}</article>
      </div>
    </div>
  );
}
