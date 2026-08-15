// Landing hero: badge, headline, one-line subhead, two CTAs, and the animated
// BuildDemo. Deliberately sparse — the demo shows what the old text console
// used to describe. Also owns EXE_URL; Footer.tsx imports it from here.

import { lazy, Suspense } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Download } from "lucide-react";

// Always points to the latest release — no hardcoded version tag that goes stale.
export const EXE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/latest/download/Thalamus.exe";

const BuildDemo = lazy(() => import("@/components/landing/BuildDemo"));

export default function Hero({ onLaunch }: { onLaunch: () => void }) {
  return (
    <section className="relative overflow-hidden px-4 pb-20 pt-32 sm:px-6">
      <div className="absolute inset-0 -z-10 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(110,231,183,0.10),transparent_45%),linear-gradient(180deg,transparent_0%,var(--background)_92%)]" />
      </div>

      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.04] px-4 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur-xl"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          L3.5 agent · free every day
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl"
        >
          Describe an app.{" "}
          <span className="bg-[linear-gradient(110deg,#6ee7b7_0%,#93c5fd_55%,#c4b5fd_100%)] bg-clip-text text-transparent">
            Watch it get built.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted-foreground"
        >
          A team of AI agents plans, writes, tests, and reviews real code — for a fraction of what the other tools charge.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a
            href="/portal"
            onClick={(e) => { e.preventDefault(); onLaunch(); }}
            className="group flex items-center gap-2 rounded-full bg-foreground px-7 py-3.5 text-sm font-semibold text-background shadow-xl shadow-black/25 transition-all hover:bg-foreground/90"
          >
            Start building free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href={EXE_URL}
            download="Thalamus.exe"
            className="flex items-center gap-2 rounded-full border border-foreground/15 px-7 py-3.5 text-sm font-semibold text-foreground transition-all hover:border-foreground/30 hover:bg-foreground/[0.05]"
          >
            <Download className="h-4 w-4" />
            Windows app
          </a>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26, duration: 0.6 }}
        className="mt-16"
      >
        <Suspense fallback={<div className="mx-auto h-[280px] w-full max-w-2xl rounded-xl border border-white/10 bg-[#0a1020]/60" />}>
          <BuildDemo />
        </Suspense>
      </motion.div>
    </section>
  );
}
