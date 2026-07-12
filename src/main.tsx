import { Toaster } from "@/components/ui/sonner";
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode, Component, useEffect, lazy, Suspense, type ReactNode } from "react";
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

// Without a boundary, a failed lazy-route chunk (typical after a deploy purges
// old hashed assets while a stale index.html is still cached) unmounts the whole
// tree and leaves a blank page. Chunk failures get one automatic reload — that
// fetches the fresh shell — before falling back to a visible error screen.
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    const isChunkError = /Failed to fetch dynamically imported module|Loading chunk|error loading dynamically imported/i.test(error.message);
    if (isChunkError && !sessionStorage.getItem("chunk-reload")) {
      sessionStorage.setItem("chunk-reload", "1");
      window.location.reload();
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-foreground font-semibold">Something went wrong loading this page.</p>
        <p className="text-muted-foreground text-sm">A new version may have been deployed.</p>
        <button
          onClick={() => { sessionStorage.removeItem("chunk-reload"); window.location.reload(); }}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
        >
          Reload
        </button>
      </div>
    );
  }
}

// Simple loading fallback for route transitions
// eslint-disable-next-line react-refresh/only-export-components -- app entry point; HMR component boundaries don't apply here
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

// A build without VITE_CONVEX_URL used to throw here at module scope — before
// React mounted — leaving a silent blank page on every route. Fail loudly instead.
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

// eslint-disable-next-line react-refresh/only-export-components -- app entry point; HMR component boundaries don't apply here
function ConfigError() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#020b1d", color: "#e2e8f0", fontFamily: "system-ui", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Deployment configuration error</h1>
        <p style={{ fontSize: 14, opacity: 0.7 }}>VITE_CONVEX_URL was not set when this build was produced.<br />Set it in the build environment and redeploy.</p>
      </div>
    </div>
  );
}

// Detect if running as Neutralinojs desktop app
const isDesktopApp = typeof window !== "undefined" && !!window.NL_PORT;

// eslint-disable-next-line react-refresh/only-export-components -- app entry point; HMR component boundaries don't apply here
function RouteSyncer() {
  const location = useLocation();
  // App booted fine — re-arm the one-shot chunk-failure auto-reload
  useEffect(() => {
    sessionStorage.removeItem("chunk-reload");
  }, []);
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
  !convex ? <ConfigError /> :
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
            <RouteErrorBoundary>
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
            </RouteErrorBoundary>
          </div>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </InstrumentationProvider>
  </StrictMode>,
);