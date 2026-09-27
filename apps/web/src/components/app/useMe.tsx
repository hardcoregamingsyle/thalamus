"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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
// underneath, so switching between /console/keys, /console/usage, etc. never
// re-fetches the account. `reload()` re-runs it after a mutation (joining
// the waitlist) that changes what /api/me itself would return.
export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    void fetchMe().then((result) => {
      if (result.ok) setMe(result.data);
      else setError(true);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <MeContext.Provider value={{ me, loading, error, reload: load }}>{children}</MeContext.Provider>
  );
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe must be used within a MeProvider");
  return ctx;
}
