import type { SourceAssistantScorer } from "./types";

export const scoreExistingFeed: SourceAssistantScorer = (obs) => {
  const feeds = obs.html?.feeds ?? obs.xml?.feeds ?? [];
  if (feeds.length === 0) return null;
  return {
    routeType: "existingFeed",
    title: "Use existing feed",
    description: "Mkfd found an RSS, Atom, or JSON Feed source that can be transformed and republished.",
    confidence: feeds[0].confidence,
    reasons: [{ code: "feed.detected", message: "An existing feed endpoint was detected." }],
    warnings: [],
    evidence: [{ label: "Feeds detected", value: feeds.length }],
  };
};
