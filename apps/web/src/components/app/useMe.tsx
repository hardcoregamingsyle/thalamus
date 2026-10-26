"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchMe } from "@/lib/me";
import type { MeResponse } from "@/lib/types";

type MeState = {
  me: MeResponse | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
};

const MeContext = createContext<MeState | null>(null);

// Loads GET /api/me once per app-shell mount and shares it with every page
// underneath, so switching between account and administration pages never
// re-fetches the account. `reload()` re-runs it after a mutation (joining
// the waitlist) that changes what /api/me itself would return.
export function MeProvider({ children }: { children: ReactNode }) {
  const requestVersion = useRef(0);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback((refresh = false) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(false);
    void fetchMe({ refresh }).then((result) => {
      if (version !== requestVersion.current) return;
      if (result.ok) setMe(result.data);
      else setError(true);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

  return <MeContext.Provider value={{ me, loading, error, reload }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe must be used within a MeProvider");
  return ctx;
}
