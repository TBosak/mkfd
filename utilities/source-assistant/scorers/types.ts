import type { SourceAssistantObservation, SourceAssistantRecommendation, SourceAssistantRouteType } from "../../../models/source-assistant.model";

export type SourceAssistantScore = Omit<SourceAssistantRecommendation, "id" | "rankScore" | "confidenceBand"> & {
  routeType: SourceAssistantRouteType;
};

export type SourceAssistantScorer = (obs: SourceAssistantObservation) => SourceAssistantScore | null;
