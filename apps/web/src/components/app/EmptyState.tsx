import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface">
        <Icon className="h-5 w-5 text-fg-subtle" strokeWidth={1.75} />
      </span>
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}
