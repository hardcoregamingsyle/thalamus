import { LockKeyhole } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

export function LockedNotice({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-border bg-surface px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-strong">
        <LockKeyhole className="h-5 w-5 text-fg-muted" strokeWidth={1.75} />
      </span>
      <p className="max-w-xs text-[15px] text-fg-muted">{message}</p>
      <ButtonLink href="/console" variant="secondary" size="sm">
        Back to overview
      </ButtonLink>
    </div>
  );
}
