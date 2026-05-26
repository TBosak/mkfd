import { extractJsonLd } from "./json-ld.utility";
import { analyzeJsonLd } from "./json-ld-analysis.utility";
import type { JsonLdFieldMappings, WebScrapingJsonLdExtractionConfig } from "../models/feed-config.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

const DEFAULT_MAPPING: Required<Pick<JsonLdFieldMappings, "title" | "description" | "link" | "pubDate" | "author" | "guid" | "content">> = {
  title: "headline",
  description: "description",
  link: "url",
  pubDate: "datePublished",
  author: "author.name",
  guid: "url",
  content: "articleBody",
};

function readPath(source: any, path?: string): unknown {
  if (!path) return undefined;
  const normalized = path.replace(/^\$\./, "").replace(/^\$/, "");
  if (!normalized) return source;
  return normalized.split(".").reduce((value, key) => {
    if (value == null) return undefined;
    if (Array.isArray(value)) return value.map((entry) => entry?.[key]).find((entry) => entry != null);
    return value[key];
  }, source);
}

function asText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") return asText((value as any).name ?? (value as any).url ?? JSON.stringify(value));
  return String(value);
}

function asCategories(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean) as string[];
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function extractJsonLdItemsFromHtml(
  html: string,
  pageUrl: string,
  extraction: WebScrapingJsonLdExtractionConfig = { mode: "jsonLdPage" },
): { items: NormalizedFeedItem[]; warnings: string[] } {
  const analysis = analyzeJsonLd(extractJsonLd(html));
  const mappings = { ...DEFAULT_MAPPING, ...(extraction.mappings ?? {}) };
  const nodes = analysis.nodes.filter((node) => analysis.highValueTypes.length === 0 || node.type.some((type) => analysis.highValueTypes.includes(type)));
  const sourceNodes = nodes.length > 0 ? nodes : analysis.nodes;
  const items = sourceNodes.map((node): NormalizedFeedItem => {
    const raw = node.raw as any;
    const link = asText(readPath(raw, mappings.link));
    return {
      title: asText(readPath(raw, mappings.title)) || asText(readPath(raw, "name")) || "Untitled item",
      description: asText(readPath(raw, mappings.description)),
      content: asText(readPath(raw, mappings.content)),
      link: link ? new URL(link, pageUrl).toString() : pageUrl,
      pubDate: asText(readPath(raw, mappings.pubDate)),
      author: asText(readPath(raw, mappings.author)),
      guid: asText(readPath(raw, mappings.guid)) || link,
      categories: asCategories(readPath(raw, mappings.categories)),
      enclosure: asText(readPath(raw, mappings.enclosure)) ? { url: asText(readPath(raw, mappings.enclosure))! } : undefined,
      raw,
    };
  });
  return {
    items,
    warnings: analysis.warnings.map((warning) => warning.message),
  };
}
