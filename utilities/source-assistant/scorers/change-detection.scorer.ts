import type { SourceAssistantScorer } from "./types";
export const scoreChangeDetection: SourceAssistantScorer = (obs) => obs.html ? {
  routeType: "changeDetection",
  title: "Track page changes",
  description: "Use change detection if the page does not expose stable item structures.",
  confidence: 0.25,
  reasons: [{ code: "fallback.page", message: "HTML content can be monitored when extraction confidence is low." }],
  warnings: [],
  evidence: [{ label: "HTML page", value: true }],
} : null;
