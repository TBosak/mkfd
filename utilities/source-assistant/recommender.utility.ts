import type { SourceAssistantConfidenceBand, SourceAssistantObservation, SourceAssistantRecommendation, SourceAssistantRouteType } from "../../models/source-assistant.model";
import type { SourceAssistantScorer } from "./scorers/types";
import { scoreCalendar } from "./scorers/calendar.scorer";
import { scoreChangeDetection } from "./scorers/change-detection.scorer";
import { scoreExistingFeed } from "./scorers/existing-feed.scorer";
import { scoreGraphql } from "./scorers/graphql.scorer";
import { scoreManual } from "./scorers/manual.scorer";
import { scoreRestApi } from "./scorers/rest-api.scorer";
import { scoreServiceConnector } from "./scorers/service-connector.scorer";
import { scoreSitemap } from "./scorers/sitemap.scorer";
import { scoreWebScraping } from "./scorers/web-scraping.scorer";

const scorers: SourceAssistantScorer[] = [
  scoreExistingFeed,
  scoreRestApi,
  scoreGraphql,
  scoreCalendar,
  scoreWebScraping,
  scoreSitemap,
  scoreServiceConnector,
  scoreChangeDetection,
  scoreManual,
];

const priorityBonus: Record<SourceAssistantRouteType, number> = {
  existingFeed: 0.12,
  restApi: 0.09,
  graphql: 0.08,
  calendar: 0.08,
  webScraping: 0.04,
  sitemap: 0.03,
  serviceConnector: 0.02,
  changeDetection: -0.02,
  manual: -0.08,
};

function band(confidence: number): SourceAssistantConfidenceBand {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

export function buildRecommendations(obs: SourceAssistantObservation): SourceAssistantRecommendation[] {
  return scorers
    .map((scorer) => scorer(obs))
    .filter(Boolean)
    .map((score, index) => ({
      ...score!,
      id: `${score!.routeType}-${index + 1}`,
      rankScore: Number((score!.confidence + priorityBonus[score!.routeType]).toFixed(4)),
      confidenceBand: band(score!.confidence),
    }))
    .filter((rec) => rec.confidence >= 0.2 || rec.routeType === "manual")
    .sort((a, b) => b.rankScore - a.rankScore);
}
