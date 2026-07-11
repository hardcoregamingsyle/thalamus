import { Toaster } from "@/components/ui/sonner";
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, Navigate } from "react-router";
import { DauTracker } from "@/components/DauTracker";
import { DesktopTitlebar } from "@/components/DesktopTitlebar";
import "./index.css";
import "./types/global.d.ts";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing"));
const AuthPage = lazy(() => import("./pages/Auth"));
const AuthDesktopPage = lazy(() => import("./pages/AuthDesktop"));
const Portal = lazy(() => import("./pages/Portal"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SyncPage = lazy(() => import("./pages/Sync"));
const ReferPage = lazy(() => import("./pages/Refer"));
const AdminPage = lazy(() => import("./pages/Admin"));
const CodeProjects = lazy(() => import("./pages/CodeProjects"));
const CodeBranches = lazy(() => import("./pages/CodeBranches"));
const CodeWorkspace = lazy(() => import("./pages/CodeWorkspace"));
const ApiPage = lazy(() => import("./pages/ApiPage"));

// Simple loading fallback for route transitions
// eslint-disable-next-line react-refresh/only-export-components -- app entry point; HMR component boundaries don't apply here
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Detect if running as Neutralinojs desktop app
const isDesktopApp = typeof window !== "undefined" && !!window.NL_PORT;

// eslint-disable-next-line react-refresh/only-export-components -- app entry point; HMR component boundaries don't apply here
function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InstrumentationProvider>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <DauTracker />
          {/* Custom frameless titlebar — only shown in desktop app */}
          <DesktopTitlebar />
          {/* Add top padding when titlebar is shown */}
          <div className={isDesktopApp ? "pt-10" : ""}>
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                {/* In desktop mode, skip landing page — go straight to auth */}
                <Route path="/" element={isDesktopApp ? <Navigate to="/auth" replace /> : <Landing />} />
                <Route path="/auth" element={<AuthPage redirectAfterAuth="/portal/chat" />} />
                <Route path="/auth/desktop" element={<AuthDesktopPage />} />
                {/* New Code Mode Routes */}
                <Route path="/portal/code" element={<CodeProjects />} />
                <Route path="/portal/code/:projectId" element={<CodeBranches />} />
                <Route path="/portal/code/:projectId/:branchId" element={<CodeWorkspace />} />
                <Route path="/portal/code/:projectId/:branchId/:subpage" element={<CodeWorkspace />} />
                {/* Portal Routes */}
                <Route path="/portal" element={<Portal />} />
                <Route path="/portal/:mode" element={<Portal />} />
                <Route path="/portal/:mode/:sessionId" element={<Portal />} />
                <Route path="/sync" element={<SyncPage />} />
                <Route path="/refer" element={<ReferPage />} />
                <Route path="/api-keys" element={<ApiPage />} />
                {/* Admin hidden in desktop mode */}
                {!isDesktopApp && <Route path="/admin" element={<AdminPage />} />}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </div>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </InstrumentationProvider>
  </StrictMode>,
);