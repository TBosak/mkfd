import axios from "axios";
import type { CalendarEventItem, CalendarFeedConfig, CalendarParseOptions } from "../models/calendar.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

export function parseIcsEvents(ics: string, options: CalendarParseOptions): CalendarEventItem[] {
  const events = [...ics.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].map((match, index) => parseEvent(match[1], index));
  const now = new Date();
  const maxDate = new Date(now.getTime() + options.windowDays * 86400000);
  return events
    .filter((event) => options.includeCanceled || event.status !== "CANCELLED")
    .filter((event) => options.includePastEvents || !event.start || event.start >= new Date(now.getTime() - 86400000))
    .filter((event) => !event.start || event.start <= maxDate)
    .sort((a, b) => options.sortOrder === "startDesc" ? (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0) : (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
    .slice(0, options.maxEvents);
}

export async function fetchAndBuildCalendarItems(config: CalendarFeedConfig): Promise<NormalizedFeedItem[]> {
  const response = await axios.get(config.url, { responseType: "text", timeout: 60000 });
  return buildCalendarItems(parseIcsEvents(String(response.data), config), config);
}

export function buildCalendarItems(events: CalendarEventItem[], config: CalendarFeedConfig): NormalizedFeedItem[] {
  return events.map((event) => ({
    title: event.summary,
    link: config.linkStrategy === "eventUrl" ? event.url : config.linkStrategy === "location" ? event.location : config.linkStrategy === "calendarUrl" ? config.url : undefined,
    description: [event.description, event.location ? `Location: ${event.location}` : ""].filter(Boolean).join("\n\n"),
    guid: event.recurrenceId ? `${event.uid}-${event.recurrenceId}` : event.uid,
    pubDate: selectDate(event, config.dateStrategy)?.toISOString(),
    author: event.organizer,
    categories: event.categories,
    raw: event,
  }));
}

function parseEvent(body: string, index: number): CalendarEventItem {
  const get = (name: string) => body.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "mi"))?.[1]?.trim();
  return {
    uid: get("UID") ?? `event-${index}`,
    summary: get("SUMMARY") ?? "(untitled event)",
    description: get("DESCRIPTION")?.replace(/\\n/g, "\n"),
    location: get("LOCATION"),
    url: get("URL"),
    organizer: get("ORGANIZER")?.replace(/^CN=([^:]+):.*$/, "$1"),
    categories: (get("CATEGORIES") ?? "").split(",").map((c) => c.trim()).filter(Boolean),
    status: get("STATUS"),
    start: parseIcsDate(get("DTSTART")),
    end: parseIcsDate(get("DTEND")),
    created: parseIcsDate(get("CREATED")),
    lastModified: parseIcsDate(get("LAST-MODIFIED")),
  };
}

function parseIcsDate(value?: string): Date | undefined {
  if (!value) return undefined;
  if (/^\d{8}$/.test(value)) return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  const normalized = value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, "$1-$2-$3T$4:$5:$6Z");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function selectDate(event: CalendarEventItem, strategy: CalendarFeedConfig["dateStrategy"]): Date | undefined {
  if (strategy === "end") return event.end ?? event.start;
  if (strategy === "created") return event.created ?? event.start;
  if (strategy === "lastModified") return event.lastModified ?? event.start;
  return event.start;
}
