import { useEffect, useState } from "react";
import { Minus, Square, X, Maximize2 } from "lucide-react";

declare global {
  interface Window {
    Neutralino?: {
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        unmaximize: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        hide: () => Promise<void>;
        show: () => Promise<void>;
        setTitle: (title: string) => Promise<void>;
        move: (x: number, y: number) => Promise<void>;
        setSize: (options: { width?: number; height?: number }) => Promise<void>;
      };
      app: {
        exit: (code?: number) => Promise<void>;
        keepAlive: () => Promise<void>;
        getConfig: () => Promise<unknown>;
        dispatch: (event: string, data?: unknown) => Promise<void>;
        broadcast: (event: string, data?: unknown) => Promise<void>;
      };
      init: () => void;
    };
    NL_PORT?: number;
    NL_TOKEN?: string;
    NL_VERSION?: string;
  }
}

export function DesktopTitlebar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const isDesktop = typeof window !== "undefined" && !!window.Neutralino;

  useEffect(() => {
    if (!isDesktop) return;
    const checkMaximized = async () => {
      try {
        const maximized = await window.Neutralino!.window.isMaximized();
        setIsMaximized(maximized);
      } catch {}
    };
    checkMaximized();
    const interval = setInterval(checkMaximized, 1000);
    return () => clearInterval(interval);
  }, [isDesktop]);

  if (!isDesktop) return null;

  const handleMinimize = async () => {
    try { await window.Neutralino!.window.minimize(); } catch {}
  };

  const handleMaximize = async () => {
    try {
      if (isMaximized) {
        await window.Neutralino!.window.unmaximize();
        setIsMaximized(false);
      } else {
        await window.Neutralino!.window.maximize();
        setIsMaximized(true);
      }
    } catch {}
  };

  const handleClose = async () => {
    try { await window.Neutralino!.app.exit(0); } catch {}
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] h-10 flex items-center justify-between select-none"
      style={{
        background: "hsl(var(--background))",
        borderBottom: "1px solid hsl(var(--border))",
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      {/* Left: Logo + Title */}
      <div className="flex items-center gap-2.5 px-4 h-full">
        <div className="w-5 h-5 rounded overflow-hidden flex-shrink-0">
          <img src="/assets/Untitled_design.png" alt="Thalamus" className="w-full h-full object-cover" />
        </div>
        <span className="text-[11px] font-bold tracking-[0.2em] text-foreground/70">THALAMUS AI</span>
        <span className="text-[9px] text-muted-foreground/50 tracking-widest hidden sm:block">by Aphantic Corporations</span>
      </div>

      {/* Center: Drag area */}
      <div className="flex-1 h-full" />

      {/* Right: Window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="h-10 w-12 flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          title="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-10 w-12 flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="3" y="1" width="8" height="8" rx="0.5" />
              <rect x="1" y="3" width="8" height="8" rx="0.5" fill="hsl(var(--background))" />
              <rect x="1" y="3" width="8" height="8" rx="0.5" />
            </svg>
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="h-10 w-12 flex items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
