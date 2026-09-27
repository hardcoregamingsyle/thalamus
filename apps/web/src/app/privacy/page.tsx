import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Thalamus",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="inline-block rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
        Draft — not final
      </p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mt-4 text-muted-foreground">
        This page is a placeholder. Thalamus's privacy policy will describe what account, usage and
        conversation data is collected, why, and how long it's kept, before the product leaves
        private beta.
      </p>
    </div>
  );
}
