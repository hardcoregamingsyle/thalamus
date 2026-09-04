import { useEffect } from "react";

const SITE = "https://thalamus.aphantic.skinticals.com";

/**
 * Sets a route's title, description, canonical, and social tags by *mutating*
 * the tags `index.html` already ships, then restores them on unmount.
 *
 * Mutating rather than rendering is the whole point. Rendering `<title>` and
 * `<link rel="canonical">` from JSX lets React 19 hoist them into `<head>`, but
 * React has no idea the static shell already contains a title, a description,
 * and a homepage canonical — so it appends, and every non-home route ended up
 * serving two canonicals and two descriptions. Google discards conflicting
 * canonicals, and one of the two pointed at the homepage, which is a direct
 * instruction to consolidate the whole site into a single URL. That is why the
 * site drew 7 impressions in a month.
 *
 * The shell's og:/twitter: tags describe the landing page, so they are updated
 * here too — otherwise every shared or previewed URL is titled "Thalamus — L3.5
 * AI Coding Agent…" no matter what page it actually is.
 */
export function usePageMeta(title: string, description: string, path: string) {
  useEffect(() => {
    const url = `${SITE}${path}`;
    const prevTitle = document.title;
    document.title = title;

    const restore: Array<() => void> = [];
    const set = (selector: string, attr: string, value: string, make: () => HTMLElement) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      if (!el) {
        el = make();
        document.head.appendChild(el);
      }
      const target = el;
      const prev = target.getAttribute(attr);
      target.setAttribute(attr, value);
      restore.push(() => {
        if (prev !== null) target.setAttribute(attr, prev);
      });
    };
    const meta = (name: string, value: string) =>
      set(`meta[name="${name}"]`, "content", value, () => {
        const m = document.createElement("meta");
        m.setAttribute("name", name);
        return m;
      });
    const og = (property: string, value: string) =>
      set(`meta[property="${property}"]`, "content", value, () => {
        const m = document.createElement("meta");
        m.setAttribute("property", property);
        return m;
      });

    meta("description", description);
    set(`link[rel="canonical"]`, "href", url, () => {
      const l = document.createElement("link");
      l.setAttribute("rel", "canonical");
      return l;
    });
    og("og:title", title);
    og("og:description", description);
    og("og:url", url);
    meta("twitter:title", title);
    meta("twitter:description", description);

    return () => {
      document.title = prevTitle;
      for (const undo of restore) undo();
    };
  }, [title, description, path]);
}
