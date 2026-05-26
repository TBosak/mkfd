import type { SourceAssistantScorer } from "./types";

export const scoreWebScraping: SourceAssistantScorer = (obs) => {
  if (!obs.html) return null;
  const hasSelectors = Boolean(obs.html.selectorPlan?.iterator);
  const jsonLdBonus = obs.html.jsonLd.itemLikeCount > 0 ? 0.15 : 0;
  return {
    routeType: "webScraping",
    title: "Scrape this page",
    description: "Use Mkfd's page extraction workflow with suggested selectors and structured-data hints.",
    confidence: Math.min(0.9, (hasSelectors ? 0.62 : 0.42) + jsonLdBonus),
    reasons: [{ code: "html.page", message: "The source is an HTML page that can be analyzed for repeated items." }],
    warnings: obs.html.jsonLd.warnings,
    evidence: [
      { label: "Selector plan", value: hasSelectors },
      { label: "JSON-LD items", value: obs.html.jsonLd.itemLikeCount },
    ],
    webScrapingPlan: {
      request: { url: obs.finalUrl },
      selectors: obs.html.selectorPlan,
      jsonLd: obs.html.jsonLd,
      forms: obs.html.forms,
      drillChainCandidates: obs.html.drillChainCandidates,
    },
  };
};
