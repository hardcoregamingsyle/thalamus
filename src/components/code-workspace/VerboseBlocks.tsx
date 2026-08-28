// Claude Code-style verbose rendering for the code-mode transcript.
//
// Committed agent messages mix prose with activity markers ([CMD: …],
// [FILE CREATED: …], [OVER TO: …]) and System messages carry the run's
// steering lines (⇄ hand-offs, ✔ completion, [ROUTING]). The old UI dumped
// them as bracketed plain text — old school. Here every marker becomes a
// proper verbose block in the Claude Code tradition: icon + bold verb +
// mono argument, a ⎿ detail line underneath, and a terminal block for
// commands. The hand-off (the run's steering event, which must never be
// hidden) gets ONE hero treatment — a gradient banner naming both ends,
// rendered from the System ⇄ line. The agent's own [OVER TO: …] marker is
// that same event's emission, so it renders as a compact violet row: one
// hand-off, one banner — and a rejected target can never paint a fake hero.
//
// All parsing lives in src/lib/verboseTranscript.ts (framework-free, unit
// tested); this file is the visual skin only.

import { useMemo, type ComponentType } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  CheckCircle2,
  Compass,
  FastForward,
  FilePenLine,
  FilePlus2,
  Globe,
  Hourglass,
  Info,
  KeyRound,
  MoveRight,
  Plug,
  Rocket,
  RotateCcw,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classifySystemLine,
  segmentVerboseContent,
  type VerboseMarker,
  type VerboseMarkerKind,
} from "@/lib/verboseTranscript";

/** Shared markdown typography for transcript prose — one constant so message
 *  bubbles and the live stream typeset identically. (Was inline in
 *  CodeWorkspace's MessageContent; moved here verbatim.) */
export const TRANSCRIPT_MD_CLASSES =
  "text-sm leading-relaxed space-y-2 " +
  "[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 " +
  "[&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 " +
  "[&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-0.5 " +
  "[&_li]:text-sm [&_p]:leading-relaxed [&_strong]:font-semibold [&_em]:italic " +
  "[&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono " +
  "[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:font-mono " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_hr]:border-border";

type IconComponent = ComponentType<{ className?: string }>;

interface KindStyle {
  icon: IconComponent;
  /** border + background of the block */
  box: string;
  /** icon + label colour */
  accent: string;
}

const KIND_STYLES: Record<VerboseMarkerKind, KindStyle> = {
  handoff: { icon: ArrowRightLeft, box: "border-violet-400/40 bg-violet-500/10", accent: "text-violet-300" },
  overto: { icon: ArrowRightLeft, box: "border-violet-400/25 bg-violet-400/5", accent: "text-violet-300" },
  route: { icon: Route, box: "border-border/50 bg-muted/30", accent: "text-muted-foreground" },
  complete: { icon: CheckCircle2, box: "border-emerald-400/30 bg-emerald-400/10", accent: "text-emerald-300" },
  retry: { icon: RotateCcw, box: "border-amber-400/30 bg-amber-400/10", accent: "text-amber-400" },
  cmd: { icon: Terminal, box: "border-emerald-500/25 bg-emerald-500/5", accent: "text-emerald-400" },
  "file-create": { icon: FilePlus2, box: "border-emerald-400/25 bg-emerald-400/5", accent: "text-emerald-400" },
  "file-edit": { icon: FilePenLine, box: "border-amber-400/25 bg-amber-400/5", accent: "text-amber-400" },
  "file-delete": { icon: Trash2, box: "border-rose-400/25 bg-rose-400/5", accent: "text-rose-400" },
  search: { icon: Search, box: "border-cyan-400/25 bg-cyan-400/5", accent: "text-cyan-400" },
  scrape: { icon: Globe, box: "border-sky-400/25 bg-sky-400/5", accent: "text-sky-400" },
  research: { icon: BookOpen, box: "border-cyan-400/25 bg-cyan-400/5", accent: "text-cyan-300" },
  mcp: { icon: Plug, box: "border-violet-400/25 bg-violet-400/5", accent: "text-violet-300" },
  "test-pass": { icon: CheckCircle2, box: "border-emerald-400/25 bg-emerald-400/5", accent: "text-emerald-400" },
  "test-fail": { icon: XCircle, box: "border-rose-400/25 bg-rose-400/5", accent: "text-rose-400" },
  "security-pass": { icon: ShieldCheck, box: "border-emerald-400/25 bg-emerald-400/5", accent: "text-emerald-400" },
  "security-fail": { icon: ShieldAlert, box: "border-rose-400/25 bg-rose-400/5", accent: "text-rose-400" },
  deploy: { icon: Rocket, box: "border-sky-400/25 bg-sky-400/5", accent: "text-sky-300" },
  "key-request": { icon: KeyRound, box: "border-amber-400/25 bg-amber-400/5", accent: "text-amber-400" },
  info: { icon: Info, box: "border-sky-400/25 bg-sky-400/5", accent: "text-sky-400" },
  mode: { icon: Shuffle, box: "border-violet-400/25 bg-violet-400/5", accent: "text-violet-300" },
  continue: { icon: FastForward, box: "border-border/50 bg-muted/30", accent: "text-muted-foreground" },
  dispatch: { icon: Compass, box: "border-violet-400/25 bg-violet-400/5", accent: "text-violet-300" },
  malformed: { icon: AlertTriangle, box: "border-rose-400/25 bg-rose-400/5", accent: "text-rose-400" },
  warning: { icon: AlertTriangle, box: "border-amber-400/25 bg-amber-400/5", accent: "text-amber-400" },
  hold: { icon: Hourglass, box: "border-sky-400/25 bg-sky-400/5", accent: "text-sky-300" },
};

/** A command gets the terminal treatment: verb header on top, dark `$`
 *  prompt block with the full command below — the Claude Code Bash block. */
function CmdBlock({ marker }: { marker: VerboseMarker }) {
  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-emerald-500/25 bg-emerald-500/5">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <span className="text-[10px] font-black tracking-[0.14em] text-emerald-400">RUN</span>
      </div>
      <div className="overflow-x-auto border-t border-emerald-500/15 bg-background/70 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-emerald-100/90">
        <span className="mr-1.5 select-none text-emerald-500">$</span>
        <span className="whitespace-pre-wrap break-all">{marker.detail}</span>
      </div>
    </div>
  );
}

/** The hand-off — the run's steering event. Names both ends (the sender from
 *  the marker, the System line, or the message's own agent) plus the reason
 *  on a ⎿ line. Gradient hero bar so it can never read as ordinary text;
 *  hiding it is exactly what the user forbade. */
function HandoffBlock({ marker, fromAgent }: { marker: VerboseMarker; fromAgent?: string }) {
  const from = marker.fromAgent ?? fromAgent;
  return (
    <div className="my-2 rounded-xl border border-violet-400/40 bg-gradient-to-r from-violet-500/15 via-violet-500/8 to-transparent px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        <span className="text-[10px] font-black tracking-[0.18em] text-violet-300">HAND OFF</span>
        {from && (
          <>
            <span className="rounded-md bg-violet-400/15 px-1.5 py-0.5 text-[11px] font-bold text-violet-200">
              {from}
            </span>
            <MoveRight className="h-3 w-3 shrink-0 text-violet-300" />
          </>
        )}
        <span className="rounded-md bg-violet-400/25 px-1.5 py-0.5 text-[11px] font-black text-violet-100">
          {marker.detail ?? "?"}
        </span>
      </div>
      {marker.secondary && (
        <p className="mt-1 pl-6 text-[11px] leading-relaxed text-violet-200/70">
          <span className="mr-1 select-none text-violet-300/50">⎿</span>
          {marker.secondary}
        </p>
      )}
    </div>
  );
}

/** Run completion — a calm green banner, not another agent bubble. */
function CompleteBlock({ marker }: { marker: VerboseMarker }) {
  return (
    <div className="my-2 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
      <span className="text-xs font-black tracking-wide text-emerald-300">RUN COMPLETE</span>
      {marker.detail && (
        <span className="truncate text-[11px] text-emerald-200/70">— {marker.detail}</span>
      )}
    </div>
  );
}

/** The standard verbose row — icon + verb + mono argument + optional ⎿
 *  detail line. One shape, per-kind colours. */
function VerboseRow({ marker }: { marker: VerboseMarker }) {
  const style = KIND_STYLES[marker.kind];
  const Icon = style.icon;
  return (
    <div className={cn("mt-1.5 flex items-start gap-2 rounded-lg border px-2.5 py-1.5", style.box)}>
      <Icon className={cn("mt-px h-3.5 w-3.5 shrink-0", style.accent)} />
      <div className="min-w-0 flex-1">
        <span className={cn("text-[10px] font-black tracking-[0.14em]", style.accent)}>
          {marker.label}
        </span>
        {marker.detail && (
          <span className="ml-2 break-words font-mono text-[11px] text-foreground/85">
            {marker.detail}
          </span>
        )}
        {marker.secondary && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            <span className="mr-1 select-none text-muted-foreground/60">⎿</span>
            {marker.secondary}
          </p>
        )}
      </div>
    </div>
  );
}

/** Render one parsed marker as its verbose block. */
export function VerboseBlock({
  marker,
  fromAgent,
}: {
  marker: VerboseMarker;
  fromAgent?: string;
}) {
  if (marker.kind === "handoff") return <HandoffBlock marker={marker} fromAgent={fromAgent} />;
  if (marker.kind === "cmd") return <CmdBlock marker={marker} />;
  if (marker.kind === "complete") return <CompleteBlock marker={marker} />;
  return <VerboseRow marker={marker} />;
}

/** Committed agent message: prose through markdown, markers as verbose
 *  blocks, in source order. `fromAgent` only matters should a System-style
 *  "handoff" hero ever appear inside an agent message — the agent's own
 *  [OVER TO: …] markers render as compact rows that already sit inside the
 *  sender's bubble. */
export function VerboseMessageContent({
  content,
  fromAgent,
}: {
  content: string;
  fromAgent?: string;
}) {
  const segments = useMemo(() => segmentVerboseContent(content), [content]);
  return (
    <div>
      {segments.map((seg, i) =>
        seg.type === "marker" ? (
          <VerboseBlock key={i} marker={seg.marker} fromAgent={fromAgent} />
        ) : (
          <div key={i} className={TRANSCRIPT_MD_CLASSES}>
            <ReactMarkdown>{seg.text}</ReactMarkdown>
          </div>
        ),
      )}
    </div>
  );
}

/** System message: the pipeline's own narration. Recognised steering lines
 *  (⇄ hand-off, ✔ complete, [ROUTING], ⚠️, ⏳) render as banners; anything
 *  else stays a small dim note — never dropped, never dressed up as prose an
 *  agent wrote. */
export function SystemLineContent({ content }: { content: string }) {
  const marker = useMemo(() => classifySystemLine(content), [content]);
  if (marker) return <VerboseBlock marker={marker} />;
  return <p className="text-xs italic text-muted-foreground">{content}</p>;
}
