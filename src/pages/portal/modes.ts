// Shared portal-mode metadata: the Mode union, VALID_MODES array, and the
// single merged metadata table consumed by Portal (desktop + inline mobile
// sidebar + GuestPortal) and MobilePortal (native mobile view).
//
// Desktop chip fields (`label`, `desc`, `color`, `accent`, `adhd`) mirror the
// look Portal.tsx used, and mobile card fields (`mobileLabel`, `mobileDesc`,
// `mobileColor`, `bg`, `emoji`, `accentColor`) mirror MobilePortal.tsx's look.
// The two label/desc variants were intentionally different sizes (short pill
// vs long marketing sentence) so we keep both instead of collapsing one away.
// `primary` flags the four modes that appear as top-level tabs; the rest are
// the "MORE MODES" set.

import { BookOpen, MessageSquare } from "lucide-react";

export type Mode =
  | "chat" | "research" | "code" | "study"
  | "designing" | "strategising" | "creative-writing"
  | "marketing" | "idea-generation" | "naming";

// Study is the only selectable mode. Everything the other nine used to cover —
// chat, research, code and the six writing/strategy variants — is the
// orchestrator's job now: it reads a request and either answers it or plans it
// into parallel tasks, so choosing a mode up front stopped being something the
// user should have to do. The `Mode` TYPE above keeps all ten literals on
// purpose: `conversations.mode` has rows written under every one of them, and
// narrowing the type would make that legacy data unreadable.
export const VALID_MODES: Mode[] = ["study"];

export interface ModeMeta {
  id: Mode;
  icon: typeof MessageSquare;
  primary: boolean;
  // Desktop chip / dropdown look (Portal.tsx + Portal's inline mobile sidebar)
  label: string;
  desc: string;
  color: string;
  accent: string;
  adhd: number;
  // Mobile card look (MobilePortal.tsx)
  mobileLabel: string;
  mobileDesc: string;
  mobileColor: string;
  bg: string;
  emoji: string;
  accentColor: string;
}

export const ALL_MODES: ModeMeta[] = [
  {
    id: "study", icon: BookOpen, primary: true,
    label: "STUDY", desc: "Study", color: "text-indigo-400",
    accent: "bg-indigo-400/15 border-indigo-400/30", adhd: 3,
    mobileLabel: "Study", mobileDesc: "Study with explanations and practice",
    mobileColor: "text-indigo-400", bg: "bg-indigo-500/15", emoji: "📚", accentColor: "#818cf8",
  },
];

export const MODES: ModeMeta[] = ALL_MODES.filter(m => m.primary);
export const MORE_MODES: ModeMeta[] = ALL_MODES.filter(m => !m.primary);
