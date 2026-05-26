import type { FeedTransformerSourceFormat } from "./feed-transformer.model";
import type { DetectedHtmlForm } from "./html-form-detection.model";
export type { DetectedHtmlForm } from "./html-form-detection.model";

export type SourceAssistantRouteType =
  | "existingFeed"
  | "webScraping"
  | "sitemap"
  | "calendar"
  | "restApi"
  | "graphql"
  | "serviceConnector"
  | "changeDetection"
  | "manual";

export type SourceAssistantConfidenceBand = "high" | "medium" | "low";

export type SourceAssistantReason = {
  code: string;
  message: string;
};

export type SourceAssistantWarning = {
  code: string;
  message: string;
};

export type SourceAssistantEvidence = {
  label: string;
  value: string | number | boolean;
};

export type FeedDiscoveryCandidate = {
  url: string;
  title?: string;
  type: FeedTransformerSourceFormat;
  confidence: number;
};

export type JsonLdNode = {
  type: string[];
  raw: unknown;
};

export type JsonLdAnalysisResult = {
  nodes: JsonLdNode[];
  itemLikeCount: number;
  highValueTypes: string[];
  warnings: SourceAssistantWarning[];
};

export type SelectorSuggestionPlan = {
  iterator?: string;
  title?: string;
  link?: string;
  description?: string;
  date?: string;
  author?: string;
};

export type JsonLdDrillChainCandidate = {
  selector: string;
  sampleUrls: string[];
  jsonLdCoverage: number;
  itemLikeCount: number;
  warnings: SourceAssistantWarning[];
};

export type SourceAssistantHtmlObservation = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  feeds: FeedDiscoveryCandidate[];
  jsonLd: JsonLdAnalysisResult;
  forms: DetectedHtmlForm[];
  selectorPlan?: SelectorSuggestionPlan;
  drillChainCandidates: JsonLdDrillChainCandidate[];
};

export type SourceAssistantJsonObservation = {
  rootKind: "array" | "object" | "primitive";
  itemCount?: number;
  keys: string[];
};

export type SourceAssistantXmlObservation = {
  rootName?: string;
  feeds: FeedDiscoveryCandidate[];
};

export type SourceAssistantObservation = {
  url: string;
  finalUrl: string;
  contentType?: string;
  status?: number;
  analyzedAt: string;
  html?: SourceAssistantHtmlObservation;
  json?: SourceAssistantJsonObservation;
  xml?: SourceAssistantXmlObservation;
  warnings: SourceAssistantWarning[];
};

export type WebScrapingAnalysisPlan = {
  request: { url: string };
  selectors?: SelectorSuggestionPlan;
  jsonLd?: JsonLdAnalysisResult;
  forms?: DetectedHtmlForm[];
  drillChainCandidates?: JsonLdDrillChainCandidate[];
};

export type SourceAssistantRecommendation = {
  id: string;
  routeType: SourceAssistantRouteType;
  title: string;
  description: string;
  confidence: number;
  rankScore: number;
  confidenceBand: SourceAssistantConfidenceBand;
  reasons: SourceAssistantReason[];
  warnings: SourceAssistantWarning[];
  evidence: SourceAssistantEvidence[];
  webScrapingPlan?: WebScrapingAnalysisPlan;
};

export type SourceAssistantAnalyzeRequest = {
  url: string;
  options?: {
    preferredRoute?: SourceAssistantRouteType;
    headers?: Record<string, string>;
  };
};

export type SourceAssistantAnalyzeResponse = {
  analysisId: string;
  analyzedAt: string;
  observation: SourceAssistantObservation;
  recommendations: SourceAssistantRecommendation[];
  warnings: SourceAssistantWarning[];
};

export type SourceAssistantApplyRequest = {
  analysisId: string;
  recommendationId: string;
  options?: Record<string, unknown>;
};

export type SourceAssistantApplyResponse = {
  routeType: SourceAssistantRouteType;
  starterConfig: Record<string, unknown>;
  recommendation: SourceAssistantRecommendation;
  warnings: SourceAssistantWarning[];
};

export type WebPageAnalysisResponse = {
  observation: SourceAssistantObservation;
  webScrapingPlan: WebScrapingAnalysisPlan;
  recommendations: SourceAssistantRecommendation[];
  warnings: SourceAssistantWarning[];
};
