import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";

/**
 * DauTracker: Tracks daily active users automatically
 * - Triggers on app load when user is authenticated
 * - Triggers on window focus (user comes back to tab)
 * - Backend throttles to avoid excessive writes (5 min cooldown)
 */
export function DauTracker() {
  const { user } = useAuth();
  const trackDailyActivity = useMutation(api.admin.trackDailyActivity);

  useEffect(() => {
    if (!user) return; // Only track authenticated users

    // Track on mount (app load)
    trackDailyActivity().catch(() => {
      // Silently fail - non-critical tracking
    });

    // Track on window focus (user returns to tab)
    const handleFocus = () => {
      trackDailyActivity().catch(() => {
        // Silently fail
      });
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [user, trackDailyActivity]);

  return null; // This component doesn't render anything
}
