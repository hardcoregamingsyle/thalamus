import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-24 sm:px-6 sm:pt-28">
      <span className="inline-block rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-fg-muted">
        Draft — not final
      </span>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Privacy policy
      </h1>
      <p className="mt-3 text-sm text-fg-subtle">Last updated September 27, 2026</p>
      <div className="mt-10 max-w-2xl space-y-4 text-[15px] leading-relaxed text-fg-muted">
        <p>
          This page is a placeholder. Thalamus's privacy policy will describe what account, usage
          and conversation data is collected, why, and how long it's kept, before the product leaves
          private beta.
        </p>
      </div>
    </div>
  );
}
