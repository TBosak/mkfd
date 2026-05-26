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

export interface SourceAssistantReason {
  code: string;
  message: string;
}

export interface SourceAssistantEvidence {
  label: string;
  value: string | number | boolean;
}

export interface SourceAssistantWarning {
  code: string;
  message: string;
}

export interface SourceAssistantRecommendation {
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
  webScrapingPlan?: Record<string, unknown>;
}

export interface SourceAssistantAnalyzeResponse {
  analysisId: string;
  analyzedAt: string;
  observation: Record<string, unknown>;
  recommendations: SourceAssistantRecommendation[];
  warnings: SourceAssistantWarning[];
}

export interface SourceAssistantApplyResponse {
  routeType: SourceAssistantRouteType;
  starterConfig: Record<string, unknown>;
  recommendation: SourceAssistantRecommendation;
  warnings: SourceAssistantWarning[];
}

export interface WebPageAnalysisResponse {
  observation: Record<string, unknown>;
  webScrapingPlan: {
    request?: { url?: string };
    selectors?: Record<string, string | undefined>;
    jsonLd?: Record<string, unknown>;
    forms?: unknown[];
    drillChainCandidates?: unknown[];
  };
  recommendations: SourceAssistantRecommendation[];
  warnings: SourceAssistantWarning[];
}
