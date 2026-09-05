import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  fetchGeoVerdict,
  loadTags,
  readConsent,
  trackPageView,
  writeConsent,
} from "@/lib/analytics";

/**
 * Google Analytics 4 / Tag Manager, loaded when an admin has set the IDs.
 *
 * Region decides the flow, not a global default:
 *   - outside the UK/EU/EEA: tags load on first render, nothing suppressed
 *   - inside it: nothing loads until the visitor accepts the banner
 *
 * The banner therefore never renders for the large majority of visitors, which
 * was the point of gating it — it is a conversion tax everywhere it is not
 * legally earned.
 */
export function Analytics() {
  const config = useQuery(api.analytics.getAnalyticsConfig, { site: "thalamus" });
  const [needsConsent, setNeedsConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!config) return;
    if (!config.ga4Id && !config.gtmId) return;
    let cancelled = false;

    void (async () => {
      const { consentRequired } = await fetchGeoVerdict();
      if (cancelled) return;
      if (!consentRequired) {
        loadTags(config);
        setReady(true);
        return;
      }
      const prior = readConsent();
      if (prior === "granted") {
        loadTags(config);
        setReady(true);
      } else if (prior === null) {
        setNeedsConsent(true);
      }
      // prior === "denied" — stay off, and do not ask again.
    })();

    return () => {
      cancelled = true;
    };
  }, [config]);

  // GA4 counts the first load itself; every route change after it is invisible
  // unless we say so.
  useEffect(() => {
    if (ready) trackPageView(location.pathname + location.search);
  }, [ready, location.pathname, location.search]);

  if (!needsConsent || !config) return null;

  const decide = (choice: "granted" | "denied") => {
    writeConsent(choice);
    setNeedsConsent(false);
    if (choice === "granted") {
      loadTags(config);
      setReady(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-white/10 bg-card/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs leading-6 text-muted-foreground">
          We use Google Analytics to see which pages people find useful. No ads, no
          profile building, and nothing loads until you choose. See our{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            privacy policy
          </a>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide("denied")}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Decline
          </button>
          <button
            onClick={() => decide("granted")}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
