import { Hash } from "lucide-react";
import type { ReactNode } from "react";

// A section heading with a hover-revealed anchor link. `id` targets the
// parent <section>, not this element, so the observer in DocsShell and the
// browser's own hash-scroll land on the same node without duplicate ids.
export function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 className="group relative flex items-center gap-2 text-xl font-semibold tracking-tight text-fg sm:text-2xl">
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="absolute -left-6 hidden text-fg-subtle opacity-0 transition-opacity duration-150 hover:text-fg group-hover:opacity-100 lg:block"
      >
        <Hash className="h-4 w-4" strokeWidth={1.75} />
      </a>
      {children}
    </h2>
  );
}
