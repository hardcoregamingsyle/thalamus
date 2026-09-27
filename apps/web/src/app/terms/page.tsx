import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — Thalamus",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="inline-block rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
        Draft — not final
      </p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Terms of service</h1>
      <p className="mt-4 text-muted-foreground">
        This page is a placeholder. Thalamus's terms of service will be published before the product
        leaves private beta.
      </p>
    </div>
  );
}
