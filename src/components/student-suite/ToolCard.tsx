// Menu tile used by StudentSuite's menu view — a title / description / icon
// button with a loading state. Kept generic so all three "generate from your
// chat" tiles and the five "science-backed method" tiles share one component.

import { ArrowRight, BookOpen, Loader2 } from "lucide-react";

export interface ToolCardProps {
  title: string;
  description: string;
  icon: typeof BookOpen;
  tone: string;
  onClick: () => void;
  disabled?: boolean;
}

export default function ToolCard({
  title,
  description,
  icon: Icon,
  tone,
  onClick,
  disabled,
}: ToolCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-4 p-4 border rounded-xl transition-all group text-left disabled:opacity-60 ${tone}`}
    >
      <div className="w-12 h-12 rounded-xl bg-background/40 border border-current/20 flex items-center justify-center shrink-0">
        {disabled ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground transition-colors">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto transition-colors group-hover:text-current shrink-0" />
    </button>
  );
}
