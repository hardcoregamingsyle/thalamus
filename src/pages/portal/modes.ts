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

import {
  MessageSquare, Search, BookOpen, Users,
  Palette, LineChart, Feather, Megaphone, Lightbulb, Tag,
} from "lucide-react";

export type Mode =
  | "chat" | "research" | "code" | "study"
  | "designing" | "strategising" | "creative-writing"
  | "marketing" | "idea-generation" | "naming";

export const VALID_MODES: Mode[] = [
  "chat", "research", "study", "code",
  "designing", "strategising", "creative-writing",
  "marketing", "idea-generation", "naming",
];

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
    id: "chat", icon: MessageSquare, primary: true,
    label: "CHAT", desc: "General", color: "text-primary",
    accent: "bg-primary/15 border-primary/30", adhd: 3,
    mobileLabel: "Chat", mobileDesc: "Ask anything, get instant answers",
    mobileColor: "text-blue-400", bg: "bg-blue-500/15", emoji: "💬", accentColor: "#60a5fa",
  },
  {
    id: "research", icon: Search, primary: true,
    label: "RESEARCH", desc: "Deep", color: "text-accent",
    accent: "bg-accent/15 border-accent/30", adhd: 2.5,
    mobileLabel: "Research", mobileDesc: "Deep research with live web data",
    mobileColor: "text-amber-400", bg: "bg-amber-500/15", emoji: "🔬", accentColor: "#fbbf24",
  },
  {
    id: "study", icon: BookOpen, primary: true,
    label: "STUDY", desc: "Study", color: "text-indigo-400",
    accent: "bg-indigo-400/15 border-indigo-400/30", adhd: 3,
    mobileLabel: "Study", mobileDesc: "Study with explanations and practice",
    mobileColor: "text-indigo-400", bg: "bg-indigo-500/15", emoji: "📚", accentColor: "#818cf8",
  },
  {
    id: "code", icon: Users, primary: true,
    label: "CODE", desc: "Multi-agent", color: "text-violet-400",
    accent: "bg-violet-400/15 border-violet-400/30", adhd: 3,
    mobileLabel: "Code", mobileDesc: "9-agent software development",
    mobileColor: "text-violet-400", bg: "bg-violet-500/15", emoji: "⚡", accentColor: "#a78bfa",
  },
  {
    id: "designing", icon: Palette, primary: false,
    label: "DESIGNING", desc: "Product Design", color: "text-pink-400",
    accent: "bg-pink-400/15 border-pink-400/30", adhd: 2,
    mobileLabel: "Designing", mobileDesc: "Product design and UI/UX concepts",
    mobileColor: "text-pink-400", bg: "bg-pink-500/15", emoji: "🎨", accentColor: "#f472b6",
  },
  {
    id: "strategising", icon: LineChart, primary: false,
    label: "STRATEGISING", desc: "Strategy", color: "text-cyan-400",
    accent: "bg-cyan-400/15 border-cyan-400/30", adhd: 2,
    mobileLabel: "Strategising", mobileDesc: "Structured strategies and roadmaps",
    mobileColor: "text-cyan-400", bg: "bg-cyan-500/15", emoji: "📈", accentColor: "#22d3ee",
  },
  {
    id: "creative-writing", icon: Feather, primary: false,
    label: "CREATIVE WRITING", desc: "Writing", color: "text-rose-400",
    accent: "bg-rose-400/15 border-rose-400/30", adhd: 2.5,
    mobileLabel: "Creative Writing", mobileDesc: "Stories, poems, scripts and prose",
    mobileColor: "text-rose-400", bg: "bg-rose-500/15", emoji: "✍️", accentColor: "#fb7185",
  },
  {
    id: "marketing", icon: Megaphone, primary: false,
    label: "MARKETING", desc: "Ads & Ideas", color: "text-orange-400",
    accent: "bg-orange-400/15 border-orange-400/30", adhd: 2.5,
    mobileLabel: "Marketing", mobileDesc: "Ad concepts and campaign ideas",
    mobileColor: "text-orange-400", bg: "bg-orange-500/15", emoji: "📣", accentColor: "#fb923c",
  },
  {
    id: "idea-generation", icon: Lightbulb, primary: false,
    label: "IDEA GENERATION", desc: "Brainstorm", color: "text-yellow-400",
    accent: "bg-yellow-400/15 border-yellow-400/30", adhd: 2.5,
    mobileLabel: "Idea Generation", mobileDesc: "Brainstorm and connect ideas",
    mobileColor: "text-yellow-400", bg: "bg-yellow-500/15", emoji: "💡", accentColor: "#facc15",
  },
  {
    id: "naming", icon: Tag, primary: false,
    label: "NAMING", desc: "Branding", color: "text-teal-400",
    accent: "bg-teal-400/15 border-teal-400/30", adhd: 2.5,
    mobileLabel: "Naming", mobileDesc: "Names, taglines and brand identities",
    mobileColor: "text-teal-400", bg: "bg-teal-500/15", emoji: "🏷️", accentColor: "#2dd4bf",
  },
];

export const MODES: ModeMeta[] = ALL_MODES.filter(m => m.primary);
export const MORE_MODES: ModeMeta[] = ALL_MODES.filter(m => !m.primary);
