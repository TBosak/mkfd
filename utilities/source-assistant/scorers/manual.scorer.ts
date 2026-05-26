import type { SourceAssistantScorer } from "./types";
export const scoreManual: SourceAssistantScorer = (obs) => ({
  routeType: "manual",
  title: "Configure manually",
  description: "Start with the manual builder when automatic recommendations are low confidence.",
  confidence: obs.warnings.length ? 0.45 : 0.2,
  reasons: [{ code: "manual.available", message: "Manual configuration is always available." }],
  warnings: obs.warnings,
  evidence: [{ label: "Warnings", value: obs.warnings.length }],
});
