import type { SourceAssistantScorer } from "./types";
export const scoreCalendar: SourceAssistantScorer = (obs) => /ical|ics|calendar/i.test(obs.contentType ?? obs.finalUrl) ? {
  routeType: "calendar",
  title: "Use calendar feed",
  description: "The source looks like an iCalendar feed or calendar endpoint.",
  confidence: 0.8,
  reasons: [{ code: "calendar.signal", message: "Calendar content type or URL signal detected." }],
  warnings: [],
  evidence: [{ label: "Content type", value: obs.contentType ?? "" }],
} : null;
