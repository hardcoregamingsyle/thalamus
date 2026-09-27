import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/Logo";

export const metadata: Metadata = {
  title: "Not found",
};

// Rendered directly by the app router outside the (marketing) group, so it
// gets no SiteNav/SiteFooter — this has to look complete standing alone.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 text-center">
      <LogoMark className="h-10 w-10" />
      <p className="text-gradient mt-8 text-7xl font-semibold tracking-[-0.03em] sm:text-8xl">
        404
      </p>
      <p className="mt-4 text-base text-fg-muted">This page doesn't exist.</p>
      <ButtonLink href="/" size="lg" className="mt-9">
        Back home
      </ButtonLink>
    </div>
  );
}
