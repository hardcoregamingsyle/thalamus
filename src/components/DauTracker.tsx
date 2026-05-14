import { useEffect, useRef, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";

/** Min time between pings (client) — backend also throttles patches to 5 min. */
const CLIENT_DAU_COOLDOWN_MS = 120_000;

/**
 * DauTracker: Tracks daily active users automatically
 * - Uses custom session token (same auth as the rest of the app)
 * - Triggers on app load when user is authenticated
 * - Triggers on window focus (debounced on the client)
 * - Backend throttles writes (5 min between patches for same UTC day)
 */
export function DauTracker() {
  const { user, token } = useAuth();
  const trackDailyActivity = useMutation(api.admin.trackDailyActivity);
  const lastPingRef = useRef(0);

  const ping = useCallback(() => {
    if (!user || !token || token.length < 32) return;
    const now = Date.now();
    if (now - lastPingRef.current < CLIENT_DAU_COOLDOWN_MS) return;
    lastPingRef.current = now;
    trackDailyActivity({ token }).catch(() => {
      // Silently fail - non-critical tracking
    });
  }, [user, token, trackDailyActivity]);

  useEffect(() => {
    if (!user || !token || token.length < 32) return;

    ping();

    const handleFocus = () => {
      ping();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [user, token, ping]);

  return null; // This component doesn't render anything
}
