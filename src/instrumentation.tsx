import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, X, AlertTriangle } from "lucide-react";
import React, { useEffect, useState } from "react";

type SyncError = {
  error: string;
  stack: string;
  filename: string;
  lineno: number;
  colno: number;
};

type AsyncError = {
  error: string;
  stack: string;
};

type GenericError = SyncError | AsyncError;

async function reportErrorToVly(errorData: {
  error: string;
  stackTrace?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}) {
  if (!import.meta.env.VITE_VLY_APP_ID) return;
  try {
    await fetch(import.meta.env.VITE_VLY_MONITORING_URL!, {
      method: "POST",
      body: JSON.stringify({
        ...errorData,
        url: window.location.href,
        projectSemanticIdentifier: import.meta.env.VITE_VLY_APP_ID,
      }),
    });
  } catch (e) {
    console.error("Failed to report error:", e);
  }
}

function ErrorDialog({
  error,
  setError,
}: {
  error: GenericError;
  setError: (error: GenericError | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 border border-red-500/60 bg-[#0a0a0a] font-mono shadow-2xl shadow-red-900/30">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-red-500/40 bg-red-950/30">
          <div className="flex items-center gap-2 text-red-400 text-sm font-bold tracking-widest uppercase">
            <AlertTriangle className="w-4 h-4" />
            RUNTIME_ERROR
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          <div className="text-red-300 text-sm mb-1 opacity-60">// error message</div>
          <div className="text-red-200 text-sm mb-4 break-all">{error.error}</div>

          {"filename" in error && error.filename && (
            <div className="text-xs text-red-400/50 mb-4">
              at {error.filename}:{(error as SyncError).lineno}:{(error as SyncError).colno}
            </div>
          )}

          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-red-400/70 hover:text-red-300 transition-colors cursor-pointer mb-2">
              <ChevronDown className="w-3 h-3" />
              stack trace
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-3 bg-black/60 border border-red-900/40 text-red-300/70 text-xs overflow-x-auto max-h-48 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <pre className="whitespace-pre-wrap break-all">{error.stack}</pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-red-500/20 flex justify-end">
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400/60 hover:text-red-300 transition-colors tracking-widest uppercase"
          >
            dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

type ErrorBoundaryState = {
  hasError: boolean;
  error: GenericError | null;
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportErrorToVly({ error: error.message, stackTrace: error.stack });
    this.setState({
      hasError: true,
      error: {
        error: error.message,
        stack: info.componentStack ?? error.stack ?? "",
      },
    });
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorDialog
          error={this.state.error}
          setError={(e) => this.setState({ hasError: !!e, error: e })}
        />
      );
    }
    return this.props.children;
  }
}

export function InstrumentationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [error, setError] = useState<GenericError | null>(null);

  useEffect(() => {
    const handleError = async (event: ErrorEvent) => {
      try {
        event.preventDefault();
        setError({
          error: event.message,
          stack: event.error?.stack || "",
          filename: event.filename || "",
          lineno: event.lineno,
          colno: event.colno,
        });
        if (import.meta.env.VITE_VLY_APP_ID) {
          await reportErrorToVly({
            error: event.message,
            stackTrace: event.error?.stack,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          });
        }
      } catch (e) {
        console.error("Error in handleError:", e);
      }
    };

    const handleRejection = async (event: PromiseRejectionEvent) => {
      try {
        if (import.meta.env.VITE_VLY_APP_ID) {
          await reportErrorToVly({
            error: event.reason?.message,
            stackTrace: event.reason?.stack,
          });
        }
        setError({
          error: event.reason?.message || "Unhandled promise rejection",
          stack: event.reason?.stack || "",
        });
      } catch (e) {
        console.error("Error in handleRejection:", e);
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return (
    <>
      <ErrorBoundary>{children}</ErrorBoundary>
      {error && <ErrorDialog error={error} setError={setError} />}
    </>
  );
}