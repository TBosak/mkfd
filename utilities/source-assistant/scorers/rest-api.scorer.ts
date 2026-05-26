import type { SourceAssistantScorer } from "./types";
export const scoreRestApi: SourceAssistantScorer = (obs) => obs.json ? {
  routeType: "restApi",
  title: "Use REST API",
  description: "The source returned JSON that can be mapped into feed items.",
  confidence: obs.json.rootKind === "array" ? 0.86 : 0.68,
  reasons: [{ code: "json.source", message: "The source response is JSON." }],
  warnings: [],
  evidence: [{ label: "JSON root", value: obs.json.rootKind }, { label: "Keys", value: obs.json.keys.join(", ") }],
} : null;
