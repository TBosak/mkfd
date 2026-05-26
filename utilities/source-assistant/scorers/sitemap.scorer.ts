import type { SourceAssistantScorer } from "./types";
export const scoreSitemap: SourceAssistantScorer = (obs) => obs.html ? {
  routeType: "sitemap",
  title: "Discover via sitemap",
  description: "Check the site's sitemap and sample linked pages for feedable content.",
  confidence: 0.35,
  reasons: [{ code: "html.site", message: "The source is a website page; sitemap discovery may find broader coverage." }],
  warnings: [],
  evidence: [{ label: "Host", value: new URL(obs.finalUrl).host }],
} : null;
