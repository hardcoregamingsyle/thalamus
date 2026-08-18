// Shared shapes for the portal views (desktop Portal + MobilePortal). The
// Convex tables these mirror live in src/convex/schema.ts; this file only
// carries the client-side projections both portals read from useQuery.

import type { Id } from "@/convex/_generated/dataModel";
import type { Mode } from "./modes";

export interface Conversation {
  _id: Id<"conversations">;
  title: string;
  mode: Mode;
  lastMessageAt?: number;
  customId?: string;
}

export interface Message {
  _id: Id<"messages">;
  role: "user" | "assistant";
  content: string;
  tokensUsed?: number;
  costCents?: number;
  createdAt?: number;
}
