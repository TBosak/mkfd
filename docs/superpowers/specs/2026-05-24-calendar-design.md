# Calendar Feeds — Design Spec

**Date:** 2026-05-24
**Tier:** R5 New Source Types
**Status:** Approved

---

## Goal

Add `feedType: calendar` as a first-class feed source for public iCalendar (`.ics`) URLs. Each calendar event becomes one RSS item. Uses structured calendar data instead of CSS selectors. Supports Google Calendar, Outlook, and any public `.ics` URL.

---

## Scope

### In scope (MVP)

- `feedType: calendar` added to `FeedType`
- `calendar` nested config block in `FeedConfig`
- `ical.js` parser
- `CalendarEventItem` normalized event model
- Date window filtering, sort order, recurring event expansion, canceled event exclusion
- Stable GUIDs: `UID` + recurrence instance start date
- `utilities/calendar.utility.ts` — parse, filter, sort, normalize
- `buildRSSFromCalendarData` in RSS builder
- Preview endpoint extension (`POST /preview`)
- Worker branch for calendar feeds
- `CalendarForm.tsx` builder UI with Calendar tab
- Light frontend URL detection hint (no silent switch)
- 13+ test fixtures and cases

### Out of scope (MVP)

- CalDAV, OAuth, Google Calendar API, Microsoft Graph
- Calendar merge feeds
- Event change detection / newly added event mode
- ICS attachment extraction from email feeds
- Past/future window split (`pastWindowDays` / `futureWindowDays`)
- Calendar-to-webhook notifications

---

## Dependencies

Must be implemented first:

- Feed Config Formalization (canonical `FeedConfig` for `feedType: calendar`)
- Normalized Feed Item Pipeline (for output serialization)

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| Calendar model | `models/calendar.model.ts` | `CalendarEventItem`, `CalendarFeedConfig`, options types |
| Calendar utility | `utilities/calendar.utility.ts` | Parse ICS, expand recurrence, filter, sort, normalize |
| RSS builder | `utilities/rss-builder.utility.ts` | Add `buildRSSFromCalendarData` |
| Calendar tests | `tests/calendar.test.ts` | Unit tests for parser and builder |
| Worker branch | `workers/feed-updater.worker.ts` | Calendar feed refresh |
| Calendar form | `frontend/src/components/forms/CalendarForm.tsx` | Calendar builder UI |
| Feed builder | `frontend/src/components/forms/FeedBuilderForm.tsx` | Add Calendar tab |

---

## Config Model

### `models/calendar.model.ts` (new)

```ts
export type CalendarDateStrategy = "start" | "end" | "created" | "lastModified";
export type CalendarSortOrder = "startAsc" | "startDesc" | "modifiedDesc";
export type CalendarLinkStrategy = "eventUrl" | "location" | "calendarUrl" | "none";

export type CalendarFeedConfig = {
  url: string;
  windowDays: number;
  includePastEvents: boolean;
  expandRecurringEvents: boolean;
  maxEvents: number;
  sortOrder: CalendarSortOrder;
  dateStrategy: CalendarDateStrategy;
  linkStrategy: CalendarLinkStrategy;
  timezoneFallback?: string;
  includeCanceled: boolean;
  filters?: {
    include?: CalendarFilterRule[];
    exclude?: CalendarFilterRule[];
  };
};

export type CalendarFilterRule = {
  field: "summary" | "location" | "description" | "categories";
  type: "keyword" | "regex";
  value: string;
  caseSensitive?: boolean;
};

export type CalendarEventItem = {
  uid: string;
  recurrenceId?: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizer?: string;
  categories: string[];
  status?: string;
  start?: Date;
  end?: Date;
  created?: Date;
  lastModified?: Date;
  sequence?: number;
};

export type CalendarParseOptions = {
  windowDays: number;
  includePastEvents: boolean;
  expandRecurringEvents: boolean;
  maxEvents: number;
  sortOrder: CalendarSortOrder;
  includeCanceled: boolean;
  timezoneFallback?: string;
};

export type CalendarParseResult = {
  events: CalendarEventItem[];
  warnings: string[];
  stats: {
    totalEvents: number;
    filteredEvents: number;
    recurringExpanded: number;
    canceledExcluded: number;
    timezoneWarnings: number;
  };
};
```

### `FeedConfig` addition

`models/feed-config.model.ts`: add `calendar?: CalendarFeedConfig` and `"calendar"` to `FeedType`.

### Defaults

```ts
{
  windowDays: 30,
  includePastEvents: false,
  expandRecurringEvents: true,
  maxEvents: 50,
  sortOrder: "startAsc",
  dateStrategy: "start",
  linkStrategy: "eventUrl",
  includeCanceled: false,
}
```

---

## Calendar Utility

### `utilities/calendar.utility.ts` (new)

```ts
export function parseCalendarEvents(
  calendarText: string,
  options: CalendarParseOptions,
): CalendarParseResult;
```

Processing flow:
1. Parse ICS with `ical.js`
2. Extract `VEVENT` components
3. Expand recurring events if `expandRecurringEvents: true` (using ical.js `iterator` or `expand`)
4. Filter by date window: `start = includePastEvents ? now - windowDays : now`, `end = now + windowDays`
5. Exclude canceled events unless `includeCanceled: true`
6. Apply `filters` (include/exclude by summary, location, description, categories)
7. Sort by `sortOrder`
8. Truncate to `maxEvents`
9. Normalize each event to `CalendarEventItem`

GUID construction:
```ts
function buildCalendarGuid(event: CalendarEventItem): string {
  const recurrencePart = event.recurrenceId ?? event.start?.toISOString() ?? "";
  return [event.uid, recurrencePart].filter(Boolean).join("#");
}
```

This ensures each instance of a recurring event gets a unique GUID.

Timezone handling:
- Use `VTIMEZONE` blocks from the ICS when present (ical.js supports this)
- Fall back to `timezoneFallback` timezone when ICS has floating time
- Emit a warning when `timezoneFallback` is used

---

## RSS Builder

### `utilities/rss-builder.utility.ts` — add `buildRSSFromCalendarData`

```ts
export function buildRSSFromCalendarData(
  events: CalendarEventItem[],
  config: FeedConfig,
): string;
```

Per-event mapping:

| RSS field | Calendar source |
|---|---|
| `title` | `SUMMARY` or "Untitled Event" |
| `description` | formatted block: start, end, location, description |
| `link` | resolved by `linkStrategy` |
| `guid` | `UID#recurrenceId_or_start.toISOString()` |
| `pubDate` | resolved by `dateStrategy` |
| `categories` | `CATEGORIES` |
| `author` | `ORGANIZER` if present |

Description format:
```
Start: Mon, 20 May 2026 09:00 AM CDT
End: Mon, 20 May 2026 10:00 AM CDT
Location: City Hall, Room 203

Council will review the annual budget proposal.
```

Link strategy:
- `eventUrl`: use `event.url` if present, else fall back to calendar source URL
- `location`: use `event.location` if it looks like a URL, else fall back to calendar source URL
- `calendarUrl`: always use calendar source URL
- `none`: omit link

---

## Preview Endpoint Extension

In the existing `POST /preview` route handler, add calendar branch:

```ts
if (body.feedType === "calendar" && body.calendar) {
  const res = await fetch(body.calendar.url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return c.json({ error: `Calendar fetch failed: HTTP ${res.status}` }, 400);
  const icsText = await res.text();
  const { events, warnings } = parseCalendarEvents(icsText, body.calendar);
  const rssXml = buildRSSFromCalendarData(events, body);
  return c.text(rssXml, 200, { "Content-Type": "application/xml" });
}
```

---

## Worker Branch

In `workers/feed-updater.worker.ts`:

```ts
if (feed.feedType === "calendar" && feed.calendar) {
  const res = await fetch(feed.calendar.url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    recordWarning(feed.feedId, `Calendar fetch failed: HTTP ${res.status}`);
    return;
  }
  const icsText = await res.text();
  const { events, warnings, stats } = parseCalendarEvents(icsText, feed.calendar);
  for (const w of warnings) recordWarning(feed.feedId, w);
  const rssXml = buildRSSFromCalendarData(events, feed);
  await Bun.write(`./public/feeds/${feed.feedName}.xml`, rssXml);
}
```

Worker warnings include: calendar fetch failed, invalid ICS, no events found, recurring events truncated, timezone fallback used, event missing UID, event missing start date, too many events truncated.

---

## Validation Rules

| Rule | Behavior |
|---|---|
| `calendar.url` required | Error |
| URL protocol must be `http` or `https` | Error |
| Content must contain `BEGIN:VCALENDAR` | Error |
| At least one `VEVENT` must exist | Error |
| `windowDays` must be 1–730 | Error |
| `maxEvents` must be 1–500 | Error |
| `refreshTime` minimum 5 minutes | Error |
| Regex filter rules must compile | Error |

---

## Frontend

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.**

### `CalendarForm.tsx` (new)

Sections:
1. **Source** — URL input, "Preview Events" button, URL detection hint
2. **Event Window** — lookahead days input, past events checkbox, max events input
3. **Recurrence** — expand recurring events checkbox, include canceled events checkbox
4. **RSS Mapping** — date strategy dropdown, link strategy dropdown
5. **Filters** — include/exclude rules for summary and location (keyword only in MVP)

URL detection: if pasted URL ends with `.ics`, `.ical`, or contains `calendar.ics`, `basic.ics`, show hint: "This looks like a calendar feed. Switch to Calendar mode?" — user must click to switch.

### `FeedBuilderForm.tsx` — add Calendar tab

Add a Calendar tab alongside Web Scraping, REST API, Email. In the tab list, grow from 3 to 4 columns. Import and render `CalendarForm` inside the new tab content.

---

## Testing

**Fixtures** (`tests/fixtures/calendars/`):
- `basic.ics` — 2 simple events with SUMMARY, DESCRIPTION, LOCATION, URL
- `all-day.ics` — 2 all-day events
- `recurring-weekly.ics` — 1 RRULE weekly event with 4 occurrences in window
- `canceled.ics` — 1 normal event + 1 STATUS:CANCELLED event
- `categories.ics` — event with CATEGORIES
- `timezone.ics` — event with TZID reference and VTIMEZONE block
- `no-uid.ics` — event missing UID field
- `missing-summary.ics` — event with no SUMMARY

**`tests/calendar.test.ts`**

Parser:
- Parses basic event into `CalendarEventItem`
- Maps SUMMARY → title
- Maps DESCRIPTION, LOCATION, URL, ORGANIZER, CATEGORIES
- Filters out future events beyond window
- Excludes past events by default
- Includes past events when `includePastEvents: true`
- Excludes canceled events by default
- Includes canceled events when `includeCanceled: true`
- Handles missing URL gracefully
- Generates stable GUID from UID + start date
- Recurring events get unique GUIDs for each instance
- `maxEvents` truncates output
- `startAsc` sort order
- `startDesc` sort order
- Handles missing UID with warning
- Handles missing start date with warning

RSS builder:
- Produces valid RSS 2.0 XML
- Event title is SUMMARY
- GUID is unique per recurrence instance
- Description includes start, end, location, description block
- Link resolves by strategy
- `pubDate` resolves by dateStrategy
- CATEGORIES maps to `<category>` elements
- ORGANIZER maps to `<author>`

---

## Acceptance Criteria

- `feedType: calendar` is recognized by the system
- User can select Calendar tab in the builder
- User can enter a public `.ics` URL
- User can choose lookahead days and max events
- User can preview generated RSS
- User can save the feed
- Worker refreshes on schedule
- Generated items have stable GUIDs
- Recurring event instances do not collide (different GUIDs per instance)
- Canceled events excluded by default
- Invalid calendar URLs produce useful errors
- No CSS selector fields shown in Calendar mode

---

## Design Decisions

### 1. Which ICS parser library?

**Options:**
- A. `ical.js` — TypeScript declarations, no deps, supports VTIMEZONE
- B. `node-ical` — common but requires additional timezone packages
- C. Write a minimal ICS parser

**Chosen: A.** `ical.js` has built-in TypeScript types, zero dependencies, and handles timezone blocks. The main caveat is that floating times without VTIMEZONE may need the `timezoneFallback` option; this is documented and acceptable for MVP.

---

### 2. GUID strategy for recurring events?

**Options:**
- A. `UID` only — collapses all instances of a recurring event
- B. `UID` + `RECURRENCE-ID` (when present) + `start.toISOString()` — unique per instance
- C. Hash of all event fields — non-deterministic across runs

**Chosen: B.** Using UID + recurrence instance start date produces a stable, unique GUID for each occurrence. `RECURRENCE-ID` is used when present (it identifies the specific instance in overrides); otherwise `start.toISOString()` distinguishes instances. This matches the feature doc's recommendation and avoids GUID collisions in recurring-event-heavy calendars.

---

### 3. Should description be a template or a fixed format?

**Options:**
- A. Fixed format: Start, End, Location, Description block — always the same
- B. User-configurable template (`calendarDescriptionTemplate`) with placeholder syntax
- C. Fixed format MVP; defer template to a later iteration

**Chosen: C.** A configurable template adds complexity without clear demand in MVP. The fixed format (Start, End, Location, Description) covers common use cases. Template support can be added later if users request custom descriptions.

---

### 4. Should the preview return an event list or RSS XML?

**Options:**
- A. Return RSS XML (same as existing preview mechanism) — no frontend changes needed
- B. Return a structured event list — better UX, requires new preview UI component
- C. Return both

**Chosen: A for MVP, C post-MVP.** The existing preview modal renders RSS XML, so returning XML from the calendar branch requires no frontend changes. A structured event table (`Found 24 events | Start | Title | Location`) would provide much better UX but is a distinct UI feature. Add it post-MVP.

---

### 5. Should past event window use a single `windowDays` or separate `pastWindowDays`/`futureWindowDays`?

**Options:**
- A. Single `windowDays` with `includePastEvents` boolean — simpler
- B. Separate `pastWindowDays` and `futureWindowDays` — more precise control
- C. Start from `now - windowDays` when `includePastEvents: true`, else start from `now`

**Chosen: A/C.** Combined: use a single `windowDays` value. When `includePastEvents: false`, start = now, end = now + windowDays. When `includePastEvents: true`, start = now - windowDays, end = now + windowDays. Separate past/future windows can be added when users request it.
