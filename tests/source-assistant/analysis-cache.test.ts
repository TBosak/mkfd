import { describe, expect, test } from "bun:test";
import { clearSourceAnalysisCache, getCachedAnalysis, makeSourceAnalysisCacheKey, setCachedAnalysis } from "../../utilities/source-assistant/analysis-cache.utility";
import type { SourceAssistantObservation } from "../../models/source-assistant.model";

const obs = (url = "https://example.com/"): SourceAssistantObservation => ({
  url,
  finalUrl: url,
  analyzedAt: new Date(0).toISOString(),
  warnings: [],
});

describe("source assistant analysis cache", () => {
  test("uses stable cache keys", () => {
    expect(makeSourceAnalysisCacheKey("https://example.com/", { a: 1 })).toBe(makeSourceAnalysisCacheKey("https://example.com/", { a: 1 }));
  });

  test("expires entries", () => {
    clearSourceAnalysisCache();
    setCachedAnalysis({ key: "x", observation: obs(), recommendations: [], now: 100, ttlMs: 5 });
    expect(getCachedAnalysis("x", 104)).not.toBeNull();
    expect(getCachedAnalysis("x", 106)).toBeNull();
  });

  test("evicts oldest entries", () => {
    clearSourceAnalysisCache();
    setCachedAnalysis({ key: "a", observation: obs("https://a.example/"), recommendations: [], now: 1, maxEntries: 2 });
    setCachedAnalysis({ key: "b", observation: obs("https://b.example/"), recommendations: [], now: 2, maxEntries: 2 });
    setCachedAnalysis({ key: "c", observation: obs("https://c.example/"), recommendations: [], now: 3, maxEntries: 2 });
    expect(getCachedAnalysis("a", 4)).toBeNull();
    expect(getCachedAnalysis("b", 4)).not.toBeNull();
  });
});
