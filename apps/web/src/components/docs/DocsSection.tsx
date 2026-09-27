import type { ReactNode } from "react";
import { Heading } from "./Heading";

export function DocsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-border pt-12 first:border-t-0 first:pt-0">
      <Heading id={id}>{title}</Heading>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}
