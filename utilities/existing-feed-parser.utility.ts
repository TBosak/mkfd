import { DOMParser } from "xmldom";
import type { FeedTransformerSourceFormat } from "../models/feed-transformer.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import { getGlobalFetchPolicyOptions, type OutboundFetchPolicyOptions } from "./outbound-fetch-policy.utility";
import { executeWithFetchPolicy } from "./fetch-policy.utility";

export type ParseExistingFeedInput = {
  url: string;
  format: FeedTransformerSourceFormat;
  headers?: Record<string, string>;
  timeoutMs?: number;
  policyOptions?: OutboundFetchPolicyOptions;
  content?: string;
  contentType?: string;
};

export type ParsedExistingFeedMetadata = {
  title?: string;
  description?: string;
  link?: string;
  language?: string;
  image?: string;
  updatedDate?: string;
  generator?: string;
};

export type ParsedExistingFeed = {
  detectedFormat: "rss" | "atom" | "jsonFeed";
  feed: ParsedExistingFeedMetadata;
  items: NormalizedFeedItem[];
  warnings: string[];
};

export async function parseExistingFeed(input: ParseExistingFeedInput): Promise<ParsedExistingFeed> {
  const warnings: string[] = [];
  let body = input.content;
  let contentType = input.contentType ?? "";

  if (body == null) {
    const policyOptions = input.policyOptions ?? getGlobalFetchPolicyOptions();
    const response = await executeWithFetchPolicy<string>({
      url: input.url,
      outboundPolicy: policyOptions,
      policy: {
        feedRunTimeoutMs: input.timeoutMs ?? 30000,
        maxResponseSizeBytes: 4 * 1024 * 1024,
        retryCount: 1,
      },
      axiosConfig: {
        headers: input.headers ?? {},
        timeout: input.timeoutMs ?? 30000,
        responseType: "text",
        transformResponse: [(data) => data],
      },
    });
    body = response.data;
    contentType = String(response.headers?.["content-type"] ?? "");
  }

  return parseExistingFeedContent({
    url: input.url,
    format: input.format,
    content: body,
    contentType,
    warnings,
  });
}

export function parseExistingFeedContent(input: {
  url: string;
  format: FeedTransformerSourceFormat;
  content: string;
  contentType?: string;
  warnings?: string[];
}): ParsedExistingFeed {
  const warnings = input.warnings ?? [];
  const trimmed = input.content.trim();
  const format = detectFormat(input.format, input.contentType ?? "", trimmed);

  if (format === "jsonFeed") return parseJsonFeed(trimmed, warnings);
  const doc = new DOMParser().parseFromString(trimmed, "text/xml");
  const root = doc.documentElement;
  if (!root) throw new Error("Existing feed XML has no root element");
  const rootName = root.localName || root.nodeName;
  if (format === "rss" || rootName.toLowerCase() === "rss") return parseRss(root, warnings);
  if (format === "atom" || rootName.toLowerCase() === "feed") return parseAtom(root, warnings);
  throw new Error(`Unsupported existing feed format for ${input.url}`);
}

function detectFormat(
  requested: FeedTransformerSourceFormat,
  contentType: string,
  content: string,
): "rss" | "atom" | "jsonFeed" {
  if (requested !== "auto") return requested;
  if (contentType.includes("feed+json") || content.startsWith("{")) return "jsonFeed";
  if (content.includes("<rss")) return "rss";
  return "atom";
}

function parseJsonFeed(content: string, warnings: string[]): ParsedExistingFeed {
  const parsed = JSON.parse(content);
  const items: NormalizedFeedItem[] = Array.isArray(parsed.items)
    ? parsed.items.map((item: any) => ({
        guid: item.id,
        title: item.title ?? item.id ?? item.url ?? "(no title)",
        link: item.url ?? item.external_url,
        description: item.summary ?? item.content_text,
        content: item.content_html ?? item.content_text,
        summary: item.summary,
        pubDate: item.date_published,
        updatedDate: item.date_modified,
        author: item.author?.name ?? item.authors?.map((a: any) => a.name).filter(Boolean).join(", "),
        categories: item.tags,
        enclosure: item.attachments?.[0]
          ? {
              url: item.attachments[0].url,
              type: item.attachments[0].mime_type,
              length: item.attachments[0].size_in_bytes,
            }
          : undefined,
        raw: item,
      }))
    : [];
  return {
    detectedFormat: "jsonFeed",
    feed: {
      title: parsed.title,
      description: parsed.description,
      link: parsed.home_page_url ?? parsed.feed_url,
      image: parsed.icon ?? parsed.favicon,
    },
    items,
    warnings,
  };
}

function parseRss(root: Element, warnings: string[]): ParsedExistingFeed {
  const channel = firstElement(root, "channel") ?? root;
  const items = elements(channel, "item").map((item) => ({
    guid: text(item, "guid"),
    title: text(item, "title") || "(no title)",
    link: text(item, "link"),
    description: text(item, "description"),
    content: text(item, "encoded") || text(item, "content:encoded"),
    contentEncoded: text(item, "encoded") || text(item, "content:encoded"),
    pubDate: text(item, "pubDate"),
    author: text(item, "creator") || text(item, "dc:creator") || text(item, "author"),
    categories: elements(item, "category").map((category) => textNode(category)).filter(Boolean),
    enclosure: enclosureFromElement(firstElement(item, "enclosure")),
    source: firstElement(item, "source")
      ? { title: textNode(firstElement(item, "source")!), url: firstElement(item, "source")!.getAttribute("url") ?? undefined }
      : undefined,
    raw: item.toString(),
  }));
  return {
    detectedFormat: "rss",
    feed: {
      title: text(channel, "title"),
      description: text(channel, "description"),
      link: text(channel, "link"),
      language: text(channel, "language"),
      image: text(firstElement(channel, "image"), "url"),
      generator: text(channel, "generator"),
      updatedDate: text(channel, "lastBuildDate") || text(channel, "pubDate"),
    },
    items,
    warnings,
  };
}

function parseAtom(root: Element, warnings: string[]): ParsedExistingFeed {
  const entries = elements(root, "entry").map((entry) => ({
    guid: text(entry, "id"),
    title: text(entry, "title") || "(no title)",
    link: atomLink(entry, "alternate"),
    description: text(entry, "summary"),
    content: text(entry, "content"),
    pubDate: text(entry, "published"),
    updatedDate: text(entry, "updated"),
    author: text(firstElement(entry, "author"), "name"),
    categories: elements(entry, "category").map((category) => category.getAttribute("term") ?? textNode(category)).filter(Boolean),
    enclosure: atomEnclosure(entry),
    raw: entry.toString(),
  }));
  return {
    detectedFormat: "atom",
    feed: {
      title: text(root, "title"),
      description: text(root, "subtitle"),
      link: atomLink(root, "alternate"),
      updatedDate: text(root, "updated"),
      generator: text(root, "generator"),
    },
    items: entries,
    warnings,
  };
}

function elements(parent: Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagName("*")).filter((el) => {
    const local = (el.localName || el.nodeName).toLowerCase();
    return local === name.toLowerCase() || el.nodeName.toLowerCase() === name.toLowerCase();
  }) as Element[];
}

function firstElement(parent: Element | null | undefined, name: string): Element | undefined {
  if (!parent) return undefined;
  return elements(parent, name)[0];
}

function text(parent: Element | null | undefined, name: string): string | undefined {
  const el = firstElement(parent, name);
  return el ? textNode(el) : undefined;
}

function textNode(el: Element): string {
  return (el.textContent ?? "").trim();
}

function enclosureFromElement(el: Element | undefined) {
  if (!el) return undefined;
  const url = el.getAttribute("url");
  if (!url) return undefined;
  const lengthRaw = el.getAttribute("length");
  return {
    url,
    type: el.getAttribute("type") ?? undefined,
    length: lengthRaw ? Number(lengthRaw) : undefined,
  };
}

function atomLink(parent: Element, rel: string): string | undefined {
  const links = elements(parent, "link");
  return links.find((link) => (link.getAttribute("rel") || "alternate") === rel)?.getAttribute("href") ?? undefined;
}

function atomEnclosure(parent: Element) {
  const link = elements(parent, "link").find((el) => el.getAttribute("rel") === "enclosure");
  if (!link) return undefined;
  const url = link.getAttribute("href");
  if (!url) return undefined;
  const lengthRaw = link.getAttribute("length");
  return {
    url,
    type: link.getAttribute("type") ?? undefined,
    length: lengthRaw ? Number(lengthRaw) : undefined,
  };
}
