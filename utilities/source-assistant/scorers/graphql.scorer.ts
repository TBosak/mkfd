import type { SourceAssistantScorer } from "./types";
export const scoreGraphql: SourceAssistantScorer = (obs) => obs.finalUrl.toLowerCase().includes("graphql") ? {
  routeType: "graphql",
  title: "Use GraphQL",
  description: "The URL looks like a GraphQL endpoint.",
  confidence: 0.74,
  reasons: [{ code: "graphql.url", message: "The source URL contains a GraphQL endpoint signal." }],
  warnings: [],
  evidence: [{ label: "URL", value: obs.finalUrl }],
} : null;
