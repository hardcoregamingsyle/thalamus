import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground">
        <span>© {new Date().getFullYear()} Thalamus</span>
        <nav className="flex gap-4">
          <Link href="/docs" className="no-underline hover:underline">
            Docs
          </Link>
          <Link href="/privacy" className="no-underline hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="no-underline hover:underline">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
