import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/Logo";
import { Reveal } from "@/components/ui/Reveal";

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden px-4 py-28 sm:px-6 sm:py-40">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_55%_at_50%_100%,color-mix(in_srgb,var(--raw-grad-2)_16%,transparent),transparent_70%)]"
      />
      <Reveal className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <LogoMark className="h-12 w-12" />
        <h2 className="mt-8 text-4xl font-semibold tracking-[-0.035em] text-fg sm:text-6xl">
          Get in early.
        </h2>
        <p className="mt-5 text-base text-fg-muted sm:text-lg">
          Private beta. Invites go out in order.
        </p>
        <ButtonLink href="/auth" size="lg" className="mt-10">
          Join the waitlist
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </ButtonLink>
      </Reveal>
    </section>
  );
}
