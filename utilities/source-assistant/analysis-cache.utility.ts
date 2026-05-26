import { createHash, randomUUID } from "node:crypto";
import type { SourceAssistantObservation, SourceAssistantRecommendation } from "../../models/source-assistant.model";

export type SourceAnalysisCacheEntry = {
  analysisId: string;
  key: string;
  observation: SourceAssistantObservation;
  recommendations: SourceAssistantRecommendation[];
  createdAt: number;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 50;

const cache = new Map<string, SourceAnalysisCacheEntry>();

export function makeSourceAnalysisCacheKey(url: string, options: Record<string, unknown> = {}): string {
  const normalizedUrl = new URL(url).toString();
  const normalizedOptions = JSON.stringify(options, Object.keys(options).sort());
  return createHash("sha256").update(`${normalizedUrl}\n${normalizedOptions}`).digest("hex");
}

export function clearSourceAnalysisCache() {
  cache.clear();
}

export function getCachedAnalysis(key: string, now = Date.now()): SourceAnalysisCacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function getCachedAnalysisById(analysisId: string, now = Date.now()): SourceAnalysisCacheEntry | null {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
      continue;
    }
    if (entry.analysisId === analysisId) return entry;
  }
  return null;
}

export function setCachedAnalysis(args: {
  key: string;
  observation: SourceAssistantObservation;
  recommendations: SourceAssistantRecommendation[];
  now?: number;
  ttlMs?: number;
  maxEntries?: number;
  analysisId?: string;
}): SourceAnalysisCacheEntry {
  const now = args.now ?? Date.now();
  const entry: SourceAnalysisCacheEntry = {
    analysisId: args.analysisId ?? randomUUID(),
    key: args.key,
    observation: args.observation,
    recommendations: args.recommendations,
    createdAt: now,
    expiresAt: now + (args.ttlMs ?? DEFAULT_TTL_MS),
  };
  cache.set(args.key, entry);

  const maxEntries = args.maxEntries ?? DEFAULT_MAX_ENTRIES;
  while (cache.size > maxEntries) {
    let oldestKey: string | undefined;
    let oldestCreatedAt = Infinity;
    for (const [key, value] of cache.entries()) {
      if (value.createdAt < oldestCreatedAt) {
        oldestCreatedAt = value.createdAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
  return entry;
}
