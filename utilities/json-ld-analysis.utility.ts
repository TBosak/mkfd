import type { JsonLdAnalysisResult, JsonLdNode } from "../models/source-assistant.model";

function asTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value) return [String(value)];
  return [];
}

const ITEM_TYPES = new Set(["Article", "NewsArticle", "BlogPosting", "PodcastEpisode", "Event", "Product"]);

export function analyzeJsonLd(nodes: unknown[]): JsonLdAnalysisResult {
  const analyzed: JsonLdNode[] = nodes.map((raw: any) => ({
    raw,
    type: asTypes(raw?.["@type"] ?? raw?.type),
  }));
  const highValueTypes = [...new Set(analyzed.flatMap((node) => node.type).filter((type) => ITEM_TYPES.has(type)))];
  return {
    nodes: analyzed,
    itemLikeCount: analyzed.filter((node) => node.type.some((type) => ITEM_TYPES.has(type))).length,
    highValueTypes,
    warnings: nodes.length === 0 ? [{ code: "jsonld.none", message: "No JSON-LD nodes found." }] : [],
  };
}
