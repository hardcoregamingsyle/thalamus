import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted-foreground">There's nothing at this address.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 font-medium text-accent-foreground no-underline hover:opacity-90"
      >
        Back to Thalamus
      </Link>
    </div>
  );
}
