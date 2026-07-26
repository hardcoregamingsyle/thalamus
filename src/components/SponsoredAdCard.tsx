import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

// The shape both the web renderers and the desktop card speak. Gravity returns
// it natively, which is what keeps a provider swap down to one fetch.
export interface GravityAd {
  adText?: string;
  title?: string;
  brandName?: string;
  cta?: string;
  url?: string;
  favicon?: string;
  clickUrl?: string;
  impUrl?: string;
}

// Lives here rather than in Portal.tsx because Portal imports MobilePortal, so
// MobilePortal cannot import back out of it without a cycle — and mobile is the
// surface that had no ad slot at all until now.
export function SponsoredAdCard({ ad, rail = false }: { ad: GravityAd; rail?: boolean }) {
  // Fire the impression pixel exactly once PER AD — the card stays mounted
  // across timed refreshes, so track the last-fired impUrl rather than a
  // lifetime boolean (which would swallow refreshed ads' impressions).
  const firedImpUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ad.impUrl || firedImpUrlRef.current === ad.impUrl) return;
    firedImpUrlRef.current = ad.impUrl;
    // window.Image — the DOM constructor (lucide-react's Image icon shadows the global here)
    new window.Image().src = ad.impUrl;
  }, [ad.impUrl]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
      <a
        href={ad.clickUrl ?? ad.url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={`block rounded-2xl px-4 py-3 text-xs leading-relaxed bg-card border border-border text-foreground hover:border-primary/40 transition-colors ${rail ? "w-full" : "max-w-[82%]"}`}
      >
        <p className="text-[9px] font-bold text-muted-foreground/60 tracking-widest uppercase mb-1">Sponsored</p>
        <div className="flex items-start gap-2">
          {ad.favicon && <img src={ad.favicon} alt="" className="w-4 h-4 rounded shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className="font-bold text-foreground">{ad.title ?? ad.brandName}</p>
            {ad.adText && <p className="text-muted-foreground mt-0.5">{ad.adText}</p>}
            {ad.cta && <span className="inline-block mt-1.5 text-primary font-bold">{ad.cta} →</span>}
          </div>
        </div>
        {/* Every slot — in-chat, rail and mobile — renders this one component,
            so the disclosure lands under all of them from here. */}
        <p className="text-[9px] text-muted-foreground/50 mt-2 leading-snug">
          Ad — sponsored placements help keep Thalamus AI free.
        </p>
      </a>
    </motion.div>
  );
}
