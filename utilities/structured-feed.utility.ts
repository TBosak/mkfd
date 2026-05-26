import type { StructuredFeedMapping, JsonArrayPathCandidate } from "../models/graphql.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

export function getByPath(input: unknown, path?: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce((value: any, part) => {
    if (value === undefined || value === null) return undefined;
    return value[part];
  }, input as any);
}

export function getArrayByPath(input: unknown, path: string): unknown[] {
  const value = getByPath(input, path);
  if (Array.isArray(value)) return value.map((item) => item?.node ?? item);
  return value ? [value] : [];
}

export function mapStructuredDataToItems(data: unknown, mapping: StructuredFeedMapping): NormalizedFeedItem[] {
  return getArrayByPath(data, mapping.itemPath).map((item) => {
    const categories = getByPath(item, mapping.categories);
    const enclosureUrl = getByPath(item, mapping.enclosureUrl);
    return {
      title: stringValue(getByPath(item, mapping.title)),
      link: stringValue(getByPath(item, mapping.link)),
      description: stringValue(getByPath(item, mapping.description)),
      content: stringValue(getByPath(item, mapping.content)),
      contentEncoded: stringValue(getByPath(item, mapping.contentEncoded)),
      summary: stringValue(getByPath(item, mapping.summary)),
      guid: stringValue(getByPath(item, mapping.guid) ?? getByPath(item, mapping.link)),
      pubDate: stringValue(getByPath(item, mapping.pubDate)),
      author: stringValue(getByPath(item, mapping.author)),
      categories: Array.isArray(categories) ? categories.map(String) : stringValue(categories)?.split(",").map((c) => c.trim()).filter(Boolean),
      enclosure: enclosureUrl ? { url: String(enclosureUrl) } : undefined,
      raw: item,
    };
  });
}

export function findJsonArrayPathCandidates(input: unknown): JsonArrayPathCandidate[] {
  const candidates: JsonArrayPathCandidate[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      const first = value[0]?.node ?? value[0];
      const sampleKeys = first && typeof first === "object" ? Object.keys(first as Record<string, unknown>).slice(0, 12) : [];
      candidates.push({ path, length: value.length, sampleKeys, confidence: Math.min(1, value.length / 5 + sampleKeys.length / 20) });
      value.forEach((item, index) => walk(item, `${path}.${index}`));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => walk(nested, path ? `${path}.${key}` : key));
    }
  };
  walk(input, "");
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
