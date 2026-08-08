// Shared types and hooks for the /admin route.
//
// Provider labels, model rosters and cost basis are served by
// adminMeta.getAdminUiMeta behind the admin token — Admin.tsx is a lazy-loaded
// public chunk, so hardcoding those names here would ship them to anyone who
// fetches /assets/Admin-<hash>.js. See src/convex/adminMeta.ts for the full
// rationale.

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export type ProviderSlug = "providerB" | "providerC" | "providerD" | "providerE";

export interface ProviderMeta {
  tabLabel: string;
  title: string;
  subtitle: string;
  emptyWarning?: string;
  readyLabel?: string;
  namePlaceholder?: string;
  modelPlaceholder?: string;
  emptyHint?: string;
  regionHint?: string;
  iamPolicy?: string;
  keyPrefix?: string;
  keyPlaceholder?: string;
  help: string[];
}

export function useAdminMeta(adminToken: string) {
  return useQuery(api.adminMeta.getAdminUiMeta, adminToken ? { adminToken } : "skip");
}

export function useProviderMeta(adminToken: string, slug: ProviderSlug): ProviderMeta {
  const meta = useAdminMeta(adminToken);
  return (meta?.providers?.[slug] as ProviderMeta | undefined) ?? {
    tabLabel: "Provider", title: "Provider", subtitle: "", help: [],
  };
}
