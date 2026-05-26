import * as cheerio from "cheerio";
import type { FeedDiscoveryCandidate } from "../models/source-assistant.model";

function normalizeFeedUrl(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

export function discoverFeeds(html: string, pageUrl: string): FeedDiscoveryCandidate[] {
  const $ = cheerio.load(html);
  const candidates: FeedDiscoveryCandidate[] = [];
  const seen = new Set<string>();

  $("link[rel='alternate'], a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    const typeAttr = ($el.attr("type") || "").toLowerCase();
    const hrefLower = href.toLowerCase();
    const text = $el.attr("title") || $el.text().trim();
    const isRss = typeAttr.includes("rss") || hrefLower.endsWith(".rss") || hrefLower.includes("rss");
    const isAtom = typeAttr.includes("atom") || hrefLower.endsWith(".atom") || hrefLower.includes("atom");
    const isJsonFeed = typeAttr.includes("feed+json") || hrefLower.includes("jsonfeed") || hrefLower.endsWith("feed.json");
    if (!isRss && !isAtom && !isJsonFeed) return;
    const url = normalizeFeedUrl(href, pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({
      url,
      title: text || undefined,
      type: isJsonFeed ? "jsonFeed" : isAtom ? "atom" : "rss",
      confidence: $el.is("link") ? 0.95 : 0.7,
    });
  });

  return candidates.sort((a, b) => b.confidence - a.confidence);
}
