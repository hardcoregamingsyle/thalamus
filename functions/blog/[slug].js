// Edge-render for /blog/<slug> posts.
//
// The site is a client-rendered SPA, so the HTML a crawler receives before it
// runs any JS is the shell: the landing page's title, the landing page's
// canonical, and an empty #root. Googlebot does render JS eventually, but a
// low-authority site gets a thin render budget, and until that second pass
// lands the post looks like a duplicate of the homepage. This Pages Function
// rewrites the shell's <head> in place and drops the post's real text into
// #root, so the first response is already the finished page.
//
// In place matters: the shell ships exactly one title, description, canonical
// and OG set. Appending would leave two of each — which is the bug this whole
// change exists to fix — so every singleton is overwritten, never duplicated.
// Only the robots meta and BlogPosting JSON-LD (which the shell lacks) are
// appended. React clears #root on mount, so a human sees the normal app.
//
// Post bodies come from the same src/content/blog.ts the SPA renders, imported
// directly — there is no second copy to drift.

import { BLOG_POSTS } from "../../src/content/blog";

const SITE = "https://thalamus.aphantic.skinticals.com";

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const slug = String(params.slug || "");
  const shell = await env.ASSETS.fetch(new URL("/index.html", request.url));

  const post = BLOG_POSTS.find((p) => p.slug === slug);
  // Unknown slug is a real 404, not a soft one that pollutes the index.
  if (!post) return serveNoindex(shell, 404);

  const url = `${SITE}/blog/${post.slug}`;
  const title = `${post.title} — Thalamus AI`;
  const description = post.metaDescription;

  const rw = new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"]', { element: (e) => e.setAttribute("content", description) })
    .on('link[rel="canonical"]', { element: (e) => e.setAttribute("href", url) })
    .on('meta[property="og:type"]', { element: (e) => e.setAttribute("content", "article") })
    .on('meta[property="og:title"]', { element: (e) => e.setAttribute("content", title) })
    .on('meta[property="og:description"]', { element: (e) => e.setAttribute("content", description) })
    .on('meta[property="og:url"]', { element: (e) => e.setAttribute("content", url) })
    .on('meta[name="twitter:title"]', { element: (e) => e.setAttribute("content", title) })
    .on('meta[name="twitter:description"]', { element: (e) => e.setAttribute("content", description) })
    .on("head", {
      element(e) {
        e.append(`<meta name="robots" content="index,follow,max-image-preview:large" />`, { html: true });
        e.append(jsonLd(post, url), { html: true });
      },
    })
    .on("#root", { element: (e) => e.append(prerender(post), { html: true }) })
    // The shell's <noscript> fallback pitches the landing page, complete with its
    // own <h1>. On a post that is duplicated marketing copy and a second H1 for
    // every non-JS crawler, so drop it — this route ships better content than the
    // fallback exists to provide. Scoped to the body so the <head> noscript that
    // loads webfonts survives.
    .on("body noscript", { element: (e) => e.remove() })
    // Same reasoning for the shell's JSON-LD @graph: it describes the landing
    // page — SoftwareApplication plus the homepage's FAQPage — and leaving it in
    // asserts the homepage's FAQ as this post's structured data. The BlogPosting
    // appended above carries its own publisher, so nothing is lost. Content
    // appended by this rewriter is not re-parsed, so this only matches the
    // shell's own block.
    .on('script[type="application/ld+json"]', { element: (e) => e.remove() });

  return capped(rw.transform(shell), 200);
}

function serveNoindex(shell, status) {
  const rw = new HTMLRewriter().on("head", {
    element: (e) => e.append(`<meta name="robots" content="noindex,follow" />`, { html: true }),
  });
  return capped(rw.transform(shell), status);
}

function capped(res, status) {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=600, s-maxage=3600");
  return new Response(res.body, { status, headers });
}

// Crawler-visible body. Cross-links to the other posts are the point as much as
// the prose is: five posts that only the sitemap knows about form no link graph,
// and internal links are how a page accrues any authority to rank with.
function prerender(post) {
  const others = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 4);
  return [
    `<main>`,
    `<h1>${esc(post.title)}</h1>`,
    `<p>${esc(post.publishDate)} · ${post.readingMinutes} min read</p>`,
    post.tags.length ? `<p>${post.tags.map((t) => esc(t)).join(", ")}</p>` : "",
    markdownToHtml(stripLeadingH1(post.bodyMarkdown)),
    others.length
      ? `<h2>More from the blog</h2><ul>${others
          .map((p) => `<li><a href="${SITE}/blog/${attr(p.slug)}">${esc(p.title)}</a></li>`)
          .join("")}</ul>`
      : "",
    `<p><a href="${SITE}/portal">Open Thalamus</a> · <a href="${SITE}/blog">All posts</a></p>`,
    `</main>`,
  ].join("");
}

function jsonLd(post, url) {
  const data = {
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
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// The SPA drops the body's leading H1 because it renders the title itself; do
// the same here so the prerendered page has exactly one H1.
function stripLeadingH1(md) {
  return md.replace(/^\s*#\s+[^\n]*\n+/, "");
}

// Enough Markdown for a crawler to read the post as structured prose. This is
// not a general renderer — react-markdown still owns what humans see — it only
// has to cover the constructs the authored posts actually use: headings, fenced
// code, lists, blockquotes, bold/italic/inline-code, links, and paragraphs.
function markdownToHtml(md) {
  const out = [];
  const blocks = String(md).split(/\n{2,}/);
  let inFence = false;
  let fence = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    // A fence can span the blank-line split, so accumulate until it closes.
    const ticks = (block.match(/```/g) || []).length;
    if (inFence || ticks % 2 === 1) {
      fence.push(raw);
      inFence = ticks % 2 === 1 ? !inFence : inFence;
      if (!inFence) {
        out.push(`<pre>${esc(fence.join("\n\n").replace(/```[^\n]*\n?/g, ""))}</pre>`);
        fence = [];
      }
      continue;
    }
    if (/^```/.test(block)) {
      out.push(`<pre>${esc(block.replace(/```[^\n]*\n?/g, ""))}</pre>`);
      continue;
    }
    const heading = block.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6); // H1 is the post title
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(block)) {
      const ordered = /^\s*\d+\./.test(block);
      const items = block
        .split("\n")
        .filter((l) => /^\s*([-*+]|\d+\.)\s+/.test(l))
        .map((l) => `<li>${inline(l.replace(/^\s*([-*+]|\d+\.)\s+/, ""))}</li>`)
        .join("");
      out.push(ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
      continue;
    }
    if (/^>\s?/.test(block)) {
      out.push(`<blockquote>${inline(block.replace(/^>\s?/gm, ""))}</blockquote>`);
      continue;
    }
    out.push(`<p>${inline(block)}</p>`);
  }
  if (fence.length) out.push(`<pre>${esc(fence.join("\n\n").replace(/```[^\n]*\n?/g, ""))}</pre>`);
  return out.join("");
}

// Escape first, then add markup, so post text can never inject HTML.
function inline(s) {
  return esc(String(s))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_m, text, href) =>
      `<a href="${attr(href.startsWith("/") ? SITE + href : href)}">${text}</a>`,
    );
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attr(s) {
  return esc(s).replace(/"/g, "&quot;");
}
