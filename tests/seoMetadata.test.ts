// Guards the three SEO surfaces that are maintained by hand in two places at
// once, where drift is silent and costs traffic rather than throwing.
//
// All three have already failed in production. The FAQ JSON-LD in index.html
// drifted two answers away from faq.ts and ended up advertising a paid tier
// ("you only pay if you want more than the daily allowance") on a product where
// PAYMENTS_DISABLED is on and the SoftwareApplication node in the same @graph
// says price: "0" — structured data contradicting the visible page. The sitemap
// listed /refer, a route that does not exist in main.tsx, which the SPA's
// catch-all served as HTTP 200. And index.html must keep exactly one of each
// singleton head tag, because functions/blog/[slug].js rewrites them in place;
// a second canonical is the bug that kept the whole site out of the index.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAQ_ITEMS } from "../src/content/faq";
import { BLOG_POSTS } from "../src/content/blog";

const root = join(import.meta.dir, "..");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const sitemap = readFileSync(join(root, "public", "sitemap.xml"), "utf8");
const mainTsx = readFileSync(join(root, "src", "main.tsx"), "utf8");

const SITE = "https://thalamus.aphantic.skinticals.com";

function faqFromJsonLd(): Array<{ q: string; a: string }> {
  const blocks = [...indexHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    const graph = JSON.parse(body)["@graph"] as Array<Record<string, unknown>>;
    const faq = graph?.find((n) => n["@type"] === "FAQPage");
    if (faq) {
      return (faq.mainEntity as Array<Record<string, never>>).map((item) => ({
        q: item.name as unknown as string,
        a: (item.acceptedAnswer as unknown as { text: string }).text,
      }));
    }
  }
  throw new Error("no FAQPage node in index.html JSON-LD");
}

describe("FAQ JSON-LD mirrors the visible FAQ", () => {
  const jsonLd = faqFromJsonLd();

  test("same number of items", () => {
    expect(jsonLd.length).toBe(FAQ_ITEMS.length);
  });

  // Word-for-word: Google treats FAQ markup that does not match the rendered
  // page as a structured-data policy violation, not a formatting nit.
  for (const [i, item] of FAQ_ITEMS.entries()) {
    test(`item ${i} matches faq.ts: ${item.q.slice(0, 48)}`, () => {
      expect(jsonLd[i]?.q).toBe(item.q);
      expect(jsonLd[i]?.a).toBe(item.a);
    });
  }
});

describe("sitemap", () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  test("lists every blog post exactly once", () => {
    for (const post of BLOG_POSTS) {
      const url = `${SITE}/blog/${post.slug}`;
      expect(locs.filter((l) => l === url).length).toBe(1);
    }
  });

  test("lists no blog URL that has no post", () => {
    const slugs = new Set(BLOG_POSTS.map((p) => p.slug));
    for (const loc of locs) {
      const match = loc.match(/\/blog\/(.+)$/);
      if (match) expect(slugs.has(match[1])).toBe(true);
    }
  });

  // The SPA's `/* /index.html 200` catch-all means a sitemap entry for a route
  // that does not exist is served as a 200 homepage duplicate, not a 404 — so
  // nothing surfaces the mistake except this check.
  test("every path has a route in main.tsx", () => {
    const routed = new Set(
      [...mainTsx.matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
    );
    for (const loc of locs) {
      const path = loc.slice(SITE.length) || "/";
      if (path.startsWith("/blog/")) continue; // covered by :slug, asserted above
      expect(routed.has(path)).toBe(true);
    }
  });
});

describe("index.html head singletons", () => {
  // functions/blog/[slug].js overwrites each of these in place. Two of any one
  // of them means the edge rewrite fixes one and leaves the other pointing at
  // the homepage.
  const singletons: Array<[string, RegExp]> = [
    ["title", /<title>/g],
    ["canonical", /<link rel="canonical"/g],
    ["description", /<meta name="description"/g],
    ["og:title", /<meta property="og:title"/g],
    ["og:description", /<meta property="og:description"/g],
    ["og:url", /<meta property="og:url"/g],
  ];
  for (const [name, re] of singletons) {
    test(`exactly one ${name}`, () => {
      expect(indexHtml.match(re)?.length ?? 0).toBe(1);
    });
  }
});
