import { Link } from "react-router";
import { BLOG_POSTS } from "@/content/blog";

// The blog index. A real, indexable content hub for the marketing site —
// static posts sourced from src/content/blog.ts, no backend call. Chrome mirrors
// the Legal pages (same header/back-link, same footer nav) so content pages feel
// like one family.

const SITE = "https://thalamus.aphantic.skinticals.com";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function Blog() {
  // Newest first — posts share a launch date, so keep the authored order stable.
  const posts = BLOG_POSTS;

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <title>Blog — Thalamus AI</title>
      <meta
        name="description"
        content="Guides and deep dives on Thalamus AI: the multi-agent Build pipeline, building apps from a prompt, and studying from your own files — free."
      />
      <link rel="canonical" href={`${SITE}/blog`} />

      <header className="border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="h-8 w-8 overflow-hidden rounded-lg border border-white/15 bg-card">
              <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
            </div>
            <span className="text-sm font-bold tracking-[0.22em] text-foreground">THALAMUS</span>
          </Link>
          <Link to="/" className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">The Thalamus blog</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground sm:text-4xl">Writing, building, and learning with AI</h1>
        <p className="mt-6 max-w-2xl text-sm leading-7 text-muted-foreground">
          How the multi-agent Build pipeline actually works, how to go from a plain-English prompt to
          tested code, and how to study from your own files. Everything here is free to try.
        </p>

        <div className="mt-12 space-y-4">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="rounded-2xl border border-white/10 bg-card/40 p-6 transition-colors hover:border-white/20 hover:bg-card/60"
            >
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <time dateTime={post.publishDate}>{formatDate(post.publishDate)}</time>
                <span aria-hidden>·</span>
                <span>{post.readingMinutes} min read</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold text-foreground">
                <Link to={`/blog/${post.slug}`} className="transition-colors hover:text-primary">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{post.metaDescription}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <Link
                to={`/blog/${post.slug}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                Read post →
              </Link>
            </article>
          ))}
        </div>

        <nav className="mt-14 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-xs text-muted-foreground" aria-label="Footer">
          <Link to="/" className="transition-colors hover:text-foreground">Home</Link>
          <Link to="/blog" className="transition-colors hover:text-foreground">Blog</Link>
          <Link to="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="transition-colors hover:text-foreground">Terms</Link>
          <Link to="/refund" className="transition-colors hover:text-foreground">Refunds</Link>
          <Link to="/contact" className="transition-colors hover:text-foreground">Contact</Link>
        </nav>
      </main>
    </div>
  );
}
