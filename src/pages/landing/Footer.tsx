// Landing footer — nav links + attribution. Uses EXE_URL from Hero so both
// the hero download button and the footer link point at the same GitHub
// Releases redirect (`.../releases/latest/download/Thalamus.exe`).

import { EXE_URL } from "./Hero";

export default function Footer() {
  return (
    <footer className="border-t border-foreground/10 px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 overflow-hidden rounded-lg border border-foreground/15 bg-card">
            <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
          </div>
          <span className="text-xs font-bold tracking-[0.22em] text-foreground">THALAMUS</span>
          <span className="text-[10px] text-muted-foreground">by Aphantic Corporations</span>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-4 text-[10px] uppercase tracking-[0.14em] text-muted-foreground" aria-label="Footer">
          <a href="#modes" className="transition-colors hover:text-foreground">Modes</a>
          <a href="#study" className="transition-colors hover:text-foreground">Study</a>
          <a href="#pipeline" className="transition-colors hover:text-foreground">Build</a>
          <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          <a href={EXE_URL} download="Thalamus.exe" className="transition-colors hover:text-foreground">Windows app</a>
          <a href="https://agentoverflow.aphantic.skinticals.com" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">AgentOverflow</a>
          <a href="/blog" className="transition-colors hover:text-foreground">Blog</a>
          <a href="/privacy" className="transition-colors hover:text-foreground">Privacy</a>
          <a href="/terms" className="transition-colors hover:text-foreground">Terms</a>
          <a href="/refund" className="transition-colors hover:text-foreground">Refunds</a>
          <a href="/contact" className="transition-colors hover:text-foreground">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
