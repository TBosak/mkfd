import axios from "axios";
import * as cheerio from "cheerio";
import type { SitemapEntry, SitemapFeedConfig, SitemapFilterRule, SitemapParseResult } from "../models/sitemap.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

export function parseSitemapXml(xml: string, sourceSitemapUrl: string): SitemapParseResult {
  const $ = cheerio.load(xml, { xmlMode: true });
  const discoveredAt = new Date().toISOString();
  const entries: SitemapEntry[] = $("url").toArray().map((el, order) => ({
    loc: $(el).find("loc").first().text().trim(),
    lastmod: $(el).find("lastmod").first().text().trim() || undefined,
    changefreq: $(el).find("changefreq").first().text().trim() || undefined,
    priority: Number($(el).find("priority").first().text().trim()) || undefined,
    sourceSitemapUrl,
    discoveredAt,
    order,
  })).filter((entry) => entry.loc);
  const childSitemaps = $("sitemap").toArray().map((el) => ({
    loc: $(el).find("loc").first().text().trim(),
    lastmod: $(el).find("lastmod").first().text().trim() || undefined,
    sourceSitemapUrl,
  })).filter((entry) => entry.loc);
  return {
    type: childSitemaps.length ? "sitemapindex" : "urlset",
    entries,
    childSitemaps,
    warnings: [],
    stats: { totalUrls: entries.length, urlsAfterFilters: entries.length, totalChildSitemaps: childSitemaps.length, fetchedChildSitemaps: 0, failedChildSitemaps: 0, duplicateUrls: 0 },
  };
}

export function applySitemapFilters(entries: SitemapEntry[], filters?: SitemapFeedConfig["filters"]): SitemapEntry[] {
  return entries.filter((entry) => {
    const includes = filters?.include ?? [];
    const excludes = filters?.exclude ?? [];
    if (includes.length && !includes.some((rule) => matchesRule(entry, rule))) return false;
    if (excludes.some((rule) => matchesRule(entry, rule))) return false;
    return true;
  });
}

export function sortSitemapEntries(entries: SitemapEntry[], sortOrder: SitemapFeedConfig["sortOrder"]): SitemapEntry[] {
  return [...entries].sort((a, b) => {
    if (sortOrder === "urlAsc") return a.loc.localeCompare(b.loc);
    if (sortOrder === "sitemapOrder") return a.order - b.order;
    const at = a.lastmod ? new Date(a.lastmod).getTime() : 0;
    const bt = b.lastmod ? new Date(b.lastmod).getTime() : 0;
    return sortOrder === "lastmodAsc" ? at - bt : bt - at;
  });
}

export async function fetchAndBuildSitemapItems(config: SitemapFeedConfig): Promise<NormalizedFeedItem[]> {
  const response = await axios.get(config.url, { responseType: "text", timeout: 60000 });
  const parsed = parseSitemapXml(String(response.data), config.url);
  const entries = sortSitemapEntries(applySitemapFilters(parsed.entries, config.filters), config.sortOrder).slice(0, config.maxItems);
  return buildSitemapItems(entries, config);
}

export function buildSitemapItems(entries: SitemapEntry[], config: SitemapFeedConfig): NormalizedFeedItem[] {
  return entries.map((entry) => {
    const url = new URL(entry.loc);
    const pathTitle = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || url.hostname).replace(/[-_]+/g, " ");
    return {
      title: config.titleStrategy === "url" ? entry.loc : config.titleStrategy === "hostnameAndPath" ? `${url.hostname}${url.pathname}` : pathTitle,
      link: entry.loc,
      description: config.descriptionStrategy === "none" ? undefined : `Sitemap URL from ${entry.sourceSitemapUrl}${entry.changefreq ? ` (${entry.changefreq})` : ""}`,
      guid: entry.loc,
      pubDate: entry.lastmod ?? entry.discoveredAt,
      raw: entry,
    };
  });
}

function matchesRule(entry: SitemapEntry, rule: SitemapFilterRule): boolean {
  const value = String((entry as any)[rule.field] ?? "");
  if (rule.type === "regex") {
    try { return new RegExp(rule.value, rule.caseSensitive ? "" : "i").test(value); } catch { return false; }
  }
  return rule.caseSensitive ? value.includes(rule.value) : value.toLowerCase().includes(rule.value.toLowerCase());
}
