import { describe, expect, test } from "bun:test";
import { buildRecommendations } from "../../utilities/source-assistant/recommender.utility";
import type { SourceAssistantObservation } from "../../models/source-assistant.model";

describe("source assistant recommender", () => {
  test("ranks existing feeds ahead of generic scraping", () => {
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
        selectorPlan: { iterator: "article" },
        drillChainCandidates: [],
      },
    };
    const recs = buildRecommendations(obs);
    expect(recs[0].routeType).toBe("existingFeed");
    expect(recs.some((rec) => rec.routeType === "webScraping")).toBe(true);
  });
});
