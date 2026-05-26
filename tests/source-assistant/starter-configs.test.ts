import { describe, expect, test } from "bun:test";
import { buildStarterConfig } from "../../utilities/source-assistant/starter-configs";
import type { SourceAssistantObservation, SourceAssistantRecommendation } from "../../models/source-assistant.model";

describe("source assistant starter configs", () => {
  test("builds feedTransformer config for existing feed recommendations", () => {
    const obs: SourceAssistantObservation = {
      url: "https://example.com",
      finalUrl: "https://example.com",
      analyzedAt: new Date(0).toISOString(),
      warnings: [],
      html: {
        title: "Example",
        feeds: [{ url: "https://example.com/feed.xml", type: "rss", confidence: 0.95 }],
        jsonLd: { nodes: [], itemLikeCount: 0, highValueTypes: [], warnings: [] },
        forms: [],
        drillChainCandidates: [],
      },
    };
    const rec: SourceAssistantRecommendation = {
      id: "existingFeed-1",
      routeType: "existingFeed",
      title: "Use feed",
      description: "",
      confidence: 0.95,
      rankScore: 1,
      confidenceBand: "high",
      reasons: [],
      warnings: [],
      evidence: [],
    };
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      feedType: "feedTransformer",
      transformerSources: [{ url: "https://example.com/feed.xml", format: "rss" }],
    });
  });
});
