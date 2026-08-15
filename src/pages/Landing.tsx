// Landing page composition. Each section lives in src/pages/landing/*.tsx;
// this file wires the auth state, the feedback modal, the scroll-driven 3D
// backdrop, and the section order.

import { lazy, Suspense, useState } from "react";
import { useScroll, useSpring } from "framer-motion";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { errMsg } from "@/lib/errorMessage";
import SuggestionFormModal, { type SuggestionFile } from "@/components/SuggestionFormModal";
import NavBar from "./landing/NavBar";
import Hero from "./landing/Hero";
import ModeGrid, { type ModeId } from "./landing/ModeGrid";
import PipelineSection from "./landing/PipelineSection";
import StudySection from "./landing/StudySection";
import FaqSection from "./landing/FaqSection";
import FinalCta from "./landing/FinalCta";
import Footer from "./landing/Footer";

// Heavy three.js scene loads after first paint and only where it can run well.
const NeuralScene = lazy(() => import("@/components/landing/NeuralScene"));

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isSuggestionSubmitting, setIsSuggestionSubmitting] = useState(false);
  const submitSuggestionMutation = useMutation(api.admin.submitSuggestion);
  const { theme, toggleTheme } = useTheme();

  // Whole-page scroll progress drives the 3D scene (smoothed so the particle
  // morph glides instead of stuttering with the wheel).
  const { scrollYProgress } = useScroll();
  const sceneProgress = useSpring(scrollYProgress, { stiffness: 55, damping: 18 });

  // The 3D backdrop only mounts where it can run well: desktop-sized screens,
  // no reduced-motion preference, WebGL available. Everyone else keeps the
  // original gradient background — same content, zero jank. Computed once at
  // mount (client-only Vite app, no SSR) so there's no first-paint flash.
  const [show3d] = useState(() => {
    if (typeof window === "undefined") return false;
    const wide = window.matchMedia("(min-width: 768px)").matches;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!wide || still) return false;
    try {
      const probe = document.createElement("canvas");
      return !!(probe.getContext("webgl2") || probe.getContext("webgl"));
    } catch {
      return false;
    }
  });

  const handleLaunch = () => navigate("/portal");
  // Both entry points hit the same route; ModeId is accepted for future
  // per-mode deep-linking but not read today.
  const handleModeSelect: (mode: ModeId) => void = () => navigate(`/portal`);

  const handleSuggestionSubmit = async (title: string, description: string, files: SuggestionFile[]) => {
    setIsSuggestionSubmitting(true);
    try {
      await submitSuggestionMutation({ title, description, files: files.length > 0 ? files : undefined });
      toast.success("Feedback submitted");
      setSuggestionsOpen(false);
    } catch (error) {
      toast.error(errMsg(error, "Failed to submit"));
    } finally {
      setIsSuggestionSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background font-sans text-foreground">
      {/* title / description / canonical for "/" live in index.html so crawlers
          and social scrapers get them without executing JS — not duplicated here
          (React 19 does not dedupe head tags, and a second copy is a split signal). */}
      <NavBar
        isAuthenticated={isAuthenticated}
        isLoading={isLoading}
        theme={theme}
        onLaunch={handleLaunch}
        onFeedback={() => setSuggestionsOpen(true)}
        onToggleTheme={toggleTheme}
      />
      {show3d && theme === "dark" && (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
          <Suspense fallback={null}>
            <NeuralScene progress={sceneProgress} />
          </Suspense>
          {/* Readability scrim — dims the particle field under the content,
              deepening toward the text-heavy lower sections. */}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,11,29,0.25)_0%,rgba(2,11,29,0.55)_35%,rgba(2,11,29,0.72)_100%)]" />
        </div>
      )}

      <div className="relative z-10">
        <Hero onLaunch={handleLaunch} />
        <ModeGrid onSelect={handleModeSelect} />
        <PipelineSection />
        <StudySection />
        <FaqSection />
        <FinalCta onLaunch={handleLaunch} onSelect={handleModeSelect} />
        <Footer />
      </div>

      {suggestionsOpen && (
        <SuggestionFormModal
          onClose={() => setSuggestionsOpen(false)}
          onSubmit={handleSuggestionSubmit}
          isSubmitting={isSuggestionSubmitting}
        />
      )}
    </div>
  );
}
