import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Application-level React error boundary.
 *
 * This used to be a full instrumentation layer inherited from the vly.ai
 * app-builder scaffold: it registered global `error` and `unhandledrejection`
 * listeners and rendered a full-screen "RUNTIME_ERROR" modal over the app for
 * ANY rejected promise — including benign ones (aborted fetches, browser
 * extension errors, a Convex query failing for an expired token). That modal
 * blocked the whole UI until manually dismissed, which is the main thing users
 * experienced as "the frontend is broken".
 *
 * The global listeners and the vly telemetry endpoint are gone. What remains
 * is a standard error boundary for genuine render errors: it shows a compact,
 * recoverable error card instead of unmounting the whole tree to a blank page.
 * Async errors are handled where they happen (toast.error at the call sites).
 */

type ErrorBoundaryState = {
  error: { message: string; stack: string } | null;
};

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error: { message: error.message, stack: error.stack ?? "" } };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack in the console for debugging; nothing is
    // reported to any external service.
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-foreground font-semibold">Something went wrong.</p>
        <p className="text-muted-foreground text-sm max-w-md break-words">
          {this.state.error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
        >
          Reload
        </button>
      </div>
    );
  }
}

export function InstrumentationProvider({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
