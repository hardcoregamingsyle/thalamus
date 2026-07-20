import { type ComponentPropsWithoutRef } from "react";
import { Link, useParams } from "react-router";
import ReactMarkdown from "react-markdown";
import { getPostBySlug } from "@/content/blog";

// A single blog post. Reads :slug, finds the static post, and renders its
// Markdown body with react-markdown (the same renderer the code workspace uses).
// Head tags (title/description/canonical) and BlogPosting JSON-LD are rendered
// inline in JSX — React 19 hoists title/meta/link, and Google reads JSON-LD from
// anywhere in the DOM.

const SITE = "https://thalamus.aphantic.skinticals.com";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

// The authored bodies open with an H1 that restates the title. We render the
// title as the page's single <h1>, so drop that leading heading to avoid a
// duplicate.
function stripLeadingH1(md: string): string {
  return md.replace(/^\s*#\s+[^\n]*\n+/, "");
}

// Same-host absolute links and root-relative links stay inside the SPA via
// <Link>; everything else opens in a new tab.
function MarkdownLink({ href = "", children }: ComponentPropsWithoutRef<"a">) {
  const internal = href.startsWith("/") || href.startsWith(SITE);
  if (internal) {
    const to = href.startsWith(SITE) ? href.slice(SITE.length) || "/" : href;
    return (
      <Link to={to} className="text-primary underline underline-offset-2 hover:text-primary/80">
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
      {children}
    </a>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="h-8 w-8 overflow-hidden rounded-lg border border-white/15 bg-card">
              <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
            </div>
            <span className="text-sm font-bold tracking-[0.22em] text-foreground">THALAMUS</span>
          </Link>
          <Link to="/blog" className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            ← All posts
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPostBySlug(slug) : undefined;

  if (!post) {
    return (
      <Chrome>
        <title>Post not found — Thalamus AI</title>
        <meta name="description" content="This blog post could not be found." />
        <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <h1 className="text-2xl font-semibold text-foreground">Post not found</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The post you are looking for does not exist or may have moved.
          </p>
          <Link
            to="/blog"
            className="mt-6 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Browse the blog
          </Link>
        </main>
      </Chrome>
    );
  }

  const canonical = `${SITE}/blog/${post.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.metaDescription,
    datePublished: post.publishDate,
    dateModified: post.publishDate,
    keywords: post.tags.join(", "),
    author: { "@type": "Organization", name: "Thalamus" },
    publisher: {
      "@type": "Organization",
      name: "Thalamus",
      logo: { "@type": "ImageObject", url: `${SITE}/thalamus-logo.png` },
    },
    image: `${SITE}/og-banner.png`,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };

  return (
    <Chrome>
      <title>{`${post.title} — Thalamus AI`}</title>
      <meta name="description" content={post.metaDescription} />
      <link rel="canonical" href={canonical} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <article>
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <time dateTime={post.publishDate}>{formatDate(post.publishDate)}</time>
            <span aria-hidden>·</span>
            <span>{post.readingMinutes} min read</span>
          </div>

          <h1 className="mt-3 text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{post.title}</h1>

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

          <div
            className="mt-10 text-[15px] leading-7 text-muted-foreground
              [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground
              [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground
              [&_h1]:mt-10 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-foreground
              [&_p]:my-4
              [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6
              [&_li]:my-1.5 [&_li]:leading-7
              [&_strong]:font-semibold [&_strong]:text-foreground
              [&_em]:italic
              [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:italic
              [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground
              [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-4
              [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.85em]"
          >
            <ReactMarkdown components={{ a: MarkdownLink }}>{stripLeadingH1(post.bodyMarkdown)}</ReactMarkdown>
          </div>
        </article>

        {/* Soft CTA into the product */}
        <div className="mt-14 rounded-2xl border border-primary/25 bg-primary/5 p-6 text-center">
          <h2 className="text-lg font-semibold text-foreground">Try it yourself — free</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">
            Chat, Build, Research, and Study all live in one place. Open the portal and hand it a real task.
          </p>
          <Link
            to="/portal"
            className="mt-5 inline-flex rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open Thalamus
          </Link>
        </div>

        <nav className="mt-12 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-xs text-muted-foreground" aria-label="Footer">
          <Link to="/" className="transition-colors hover:text-foreground">Home</Link>
          <Link to="/blog" className="transition-colors hover:text-foreground">Blog</Link>
          <Link to="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="transition-colors hover:text-foreground">Terms</Link>
          <Link to="/contact" className="transition-colors hover:text-foreground">Contact</Link>
        </nav>
      </main>
    </Chrome>
  );
}
