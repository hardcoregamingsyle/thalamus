import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/chat", label: "Chat" },
      { href: "/console", label: "Console" },
      { href: "/docs", label: "API docs" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-14 sm:flex-row sm:justify-between sm:px-6">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-fg-subtle">
            A model built on a non-transformer architecture.
          </p>
        </div>
        <div className="flex gap-16">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
                {col.title}
              </p>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-fg-muted transition-colors hover:text-fg"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-10 text-xs text-fg-subtle sm:px-6">
        © 2026 Thalamus
      </div>
    </footer>
  );
}
