// Mobile portal dispatcher. Renders MobileHomeScreen when no mode is picked
// yet, otherwise the per-mode MobileChatView. Auth is checked in Portal.tsx
// before this component runs, but a defensive redirect stays here for the
// mounted-directly case.

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useParams } from "react-router";
import { useMutation } from "convex/react";
import { Cpu } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { VALID_MODES, type Mode } from "./portal/modes";
import MobileHomeScreen from "./mobile/MobileHomeScreen";
import MobileChatView from "./mobile/MobileChatView";

export default function MobilePortal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();

  const activeMode: Mode | null = (VALID_MODES.includes(params.mode as Mode) ? params.mode : null) as Mode | null;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  const ensureDailyBalance = useMutation(api.customAuthHelpers.ensureDailyBalance);
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (token && user !== undefined && user !== null && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      ensureDailyBalance({ token }).catch(() => {});
    }
  }, [token, user, ensureDailyBalance]);

  const typedUser = user as { dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;
  const totalAB = dailyAB + purchasedAB;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-3xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Cpu className="h-7 w-7 text-primary animate-pulse" />
          </div>
          <p className="text-[14px] text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const handleModeSelect = (mode: Mode) => navigate(`/portal/${mode}`);
  const handleBack = () => navigate("/portal");

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AnimatePresence mode="wait">
        {!activeMode ? (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} className="flex-1 overflow-hidden h-full">
            <MobileHomeScreen token={token ?? ""} user={user} totalAB={totalAB} onModeSelect={handleModeSelect} onSignOut={signOut} />
          </motion.div>
        ) : (
          <motion.div key={activeMode} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex-1 h-full">
            <MobileChatView mode={activeMode} token={token ?? ""} user={user} onBack={handleBack} totalAB={totalAB} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
