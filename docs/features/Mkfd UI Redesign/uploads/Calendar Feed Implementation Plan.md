Below is an implementation plan for adding **Calendar feeds** as a fourth Mkfd source type alongside web scraping, REST API, and email.

The goal should be:

> Add first-class `.ics` / iCalendar-to-RSS feed generation, using structured calendar data instead of CSS selectors.

Mkfd already has the right architecture for this: the current feed builder UI branches by feed type, the backend already has separate RSS-building paths for scraped HTML and API data, and email feeds are already treated as their own source type. Calendar feeds should follow that same pattern.

---

# Calendar Feed Implementation Plan

## Phase 1: Define the product behavior

### MVP scope

Support public iCalendar URLs:

```text
https://example.com/calendar.ics
https://calendar.google.com/calendar/ical/.../public/basic.ics
https://outlook.office365.com/owa/calendar/.../calendar.ics
```

For the first version, avoid CalDAV, OAuth, private Google Calendar auth, and Microsoft Graph. Those can come later.

### MVP user flow

1. User opens Feed Builder.
    
2. User selects **Calendar** tab.
    
3. User enters a calendar URL.
    
4. Mkfd fetches and parses the calendar.
    
5. User chooses event window, max events, sort behavior, and mapping options.
    
6. User previews the generated RSS feed.
    
7. User saves the feed.
    
8. Worker refreshes it on interval like other generated feeds.
    

### Output behavior

Each calendar event becomes one RSS item.

Default mapping:

|RSS field|Calendar source|
|---|---|
|title|`SUMMARY`|
|description|formatted event details: start, end, location, description|
|link|`URL` if available, otherwise calendar source URL|
|guid|`UID` + recurrence instance date|
|pubDate|event start date or last modified date|
|categories|`CATEGORIES`|
|author|`ORGANIZER` if available|

---

# Phase 2: Add Calendar to shared feed types

Mkfd’s frontend currently has this source union:

```ts
"webScraping" | "api" | "email"
```

Add:

```ts
"calendar"
```

## Update frontend feed form type

Find the shared `FeedFormData` type and add calendar fields.

Suggested fields:

```ts
export type CalendarDateStrategy = "start" | "end" | "created" | "lastModified";
export type CalendarSortOrder = "startAsc" | "startDesc" | "modifiedDesc";
export type CalendarLinkStrategy = "eventUrl" | "location" | "calendarUrl" | "none";

export interface CalendarFeedOptions {
  calendarUrl: string;
  calendarWindowDays: number;
  calendarIncludePastEvents: boolean;
  calendarExpandRecurringEvents: boolean;
  calendarMaxEvents: number;
  calendarSortOrder: CalendarSortOrder;
  calendarDateStrategy: CalendarDateStrategy;
  calendarLinkStrategy: CalendarLinkStrategy;
  calendarTimezoneFallback?: string;
  calendarIncludeCanceled: boolean;
  calendarTitleTemplate?: string;
  calendarDescriptionTemplate?: string;
}
```

Then extend `FeedFormData`:

```ts
export interface FeedFormData extends CalendarFeedOptions {
  feedType: "webScraping" | "api" | "email" | "calendar";
}
```

### Recommended defaults

Add these defaults in `FeedBuilderForm`:

```ts
feedType: "webScraping",
calendarWindowDays: 30,
calendarIncludePastEvents: false,
calendarExpandRecurringEvents: true,
calendarMaxEvents: 50,
calendarSortOrder: "startAsc",
calendarDateStrategy: "start",
calendarLinkStrategy: "eventUrl",
calendarIncludeCanceled: false,
```

The existing form already sets source-specific defaults for refresh interval, email count, strict mode, and webhook behavior, so this fits the current pattern.

---

# Phase 3: Add Calendar tab to the UI

The current UI has tabs for Web Scraping, REST API, and Email. Add Calendar as a fourth tab.

## Modify tab layout

Current:

```tsx
<TabsList className="grid w-full grid-cols-3">
```

Change to:

```tsx
<TabsList className="grid w-full grid-cols-4">
```

Add trigger:

```tsx
<TabsTrigger value="calendar">
  <CalendarDays className="mr-2 h-4 w-4" />
  Calendar
</TabsTrigger>
```

Add content:

```tsx
<TabsContent value="calendar">
  <CalendarForm
    register={register}
    control={control}
    setValue={setValue}
    watch={watch}
  />
</TabsContent>
```

## Create `CalendarForm.tsx`

This should be separate from `WebScrapingForm`. Do not reuse selector fields. Calendar data is structured, so CSS selector options would make the interface feel confusing.

Suggested UI sections:

### Source

```text
Calendar URL
[ https://example.com/calendar.ics ]

Detect calendar
[ Preview Events ]
```

### Event window

```text
Include events from:
[ Now ] or [ Today ] or [ Custom start date later ]

Look ahead:
[ 30 ] days

Include past events:
[ ] Yes

Max events:
[ 50 ]
```

### Recurrence

```text
Expand recurring events:
[x] Yes

Include canceled events:
[ ] Yes
```

### RSS mapping

```text
Item title:
[ Event summary ]

Description format:
[ Default event details ]

Link strategy:
[ Event URL | Location | Calendar URL | No link ]

Date strategy:
[ Start time | End time | Last modified | Created ]
```

### Filters

For MVP, you can either reuse planned general filters later or include simple calendar-specific filters:

```text
Include if summary contains
Exclude if summary contains
Include if location contains
Exclude if location contains
```

I would not overbuild filters in the first pass. Calendar feeds become much more powerful once the general per-feed filtering pipeline exists.

---

# Phase 4: Add backend config model

Mkfd currently uses YAML config files and form data to produce feed configs. Calendar config should be represented as a new source type instead of forcing selector-like fields into the existing web scraping structure.

Suggested YAML shape:

```yaml
feedType: calendar
feedName: local-events
feedUrl: https://example.com/events.ics
refreshTime: 60

calendar:
  url: https://example.com/events.ics
  windowDays: 30
  includePastEvents: false
  expandRecurringEvents: true
  maxEvents: 50
  sortOrder: startAsc
  dateStrategy: start
  linkStrategy: eventUrl
  includeCanceled: false
  timezoneFallback: America/Chicago
```

You can keep `feedUrl` as a top-level alias for UI compatibility, but I would still nest calendar-specific behavior under `calendar`.

## Why nested config is better

Avoid this long-term pattern:

```yaml
calendarUrl: ...
calendarWindowDays: ...
calendarMaxEvents: ...
calendarSortOrder: ...
```

It works, but as Mkfd adds sitemap, GraphQL, adapters, and transformers, top-level config fields will become messy.

Better long-term shape:

```yaml
source:
  type: calendar
  url: https://example.com/events.ics
  options:
    windowDays: 30
    expandRecurringEvents: true
```

But if that refactor is too big right now, use the simpler nested `calendar` block and migrate later.

---

# Phase 5: Choose parser dependency

I would start with **`ical.js`**.

Reasons:

- It parses iCalendar data.
    
- It supports iCalendar concepts directly.
    
- The npm package is actively published, has built-in TypeScript declarations, and no dependencies according to the package page. ([npm](https://www.npmjs.com/package/ical.js "ical.js - npm"))
    
- It is written in modern JavaScript and can be imported normally. ([npm](https://www.npmjs.com/package/ical.js "ical.js - npm"))
    

Install:

```bash
bun add ical.js
```

Potential caveat: timezone handling can be tricky. The package notes that stock `ical.js` does not register timezones by default, and timezone conversion may require additional timezone data if the ICS file does not include timezone definitions. ([npm](https://www.npmjs.com/package/ical.js "ical.js - npm"))

For MVP, this is acceptable if you:

- preserve event times as faithfully as possible
    
- use included `VTIMEZONE` data when present
    
- expose a fallback timezone option
    
- log warnings when timezone data is ambiguous
    

---

# Phase 6: Create calendar utility

Add:

```text
utilities/calendar.utility.ts
```

Responsibilities:

- fetch or receive raw ICS text
    
- parse calendar text
    
- extract events
    
- optionally expand recurrence
    
- normalize fields
    
- filter by date window
    
- sort
    
- convert to a generic event model
    

## Suggested internal model

```ts
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
```

## Utility API

```ts
export type CalendarParseOptions = {
  windowDays: number;
  includePastEvents: boolean;
  expandRecurringEvents: boolean;
  maxEvents: number;
  sortOrder: "startAsc" | "startDesc" | "modifiedDesc";
  includeCanceled: boolean;
  timezoneFallback?: string;
};

export function parseCalendarEvents(
  calendarText: string,
  options: CalendarParseOptions,
): CalendarEventItem[] {
  // implementation
}
```

## Date window behavior

For MVP:

```text
start = includePastEvents ? now - windowDays : now
end = now + windowDays
```

Later, split into:

```text
pastWindowDays
futureWindowDays
```

---

# Phase 7: Add RSS builder path

Mkfd already has `buildRSS` for scraped HTML and `buildRSSFromApiData` for API mappings. Add:

```text
buildRSSFromCalendarData
```

in `rss-builder.utility.ts` or a separate utility imported by it.

Suggested signature:

```ts
export function buildRSSFromCalendarData(
  events: CalendarEventItem[],
  config: CalendarFeedConfig,
): string {
  // returns XML
}
```

## RSS item construction

For each event:

```ts
const title = event.summary || "Untitled Event";

const description = [
  event.start ? `Start: ${formatDate(event.start)}` : "",
  event.end ? `End: ${formatDate(event.end)}` : "",
  event.location ? `Location: ${event.location}` : "",
  event.description || "",
].filter(Boolean).join("\n\n");

const link = resolveCalendarEventLink(event, config);

const guid = [
  event.uid,
  event.recurrenceId || event.start?.toISOString() || "",
].filter(Boolean).join("#");
```

## Date strategy

```ts
function getCalendarItemDate(event, strategy) {
  if (strategy === "start") return event.start;
  if (strategy === "end") return event.end;
  if (strategy === "lastModified") return event.lastModified;
  if (strategy === "created") return event.created;
  return event.start || event.lastModified || new Date();
}
```

## Important GUID rule

For recurring events, do not use only `UID`.

Use:

```text
UID + recurrence instance start date
```

Otherwise every occurrence of the same recurring event collapses into a single item.

---

# Phase 8: Add worker support

Update `feed-updater.worker.ts`.

Current worker already branches by source behavior for web scraping and API generation, and email has its own worker path. Calendar should be interval-based like web/API, not continuous like IMAP.

Add branch:

```ts
if (feed.feedType === "calendar") {
  const response = await axios.get(calendarUrl, {
    timeout,
    headers,
  });

  const events = parseCalendarEvents(response.data, calendarOptions);
  const rssXml = buildRSSFromCalendarData(events, feed);

  await Bun.write(`./public/feeds/${feedId}.xml`, rssXml);
}
```

Include:

- timeout
    
- retry support when added
    
- custom user agent support when added
    
- proxy support later
    
- health logging
    

## Calendar-specific worker warnings

Record warnings for health dashboard:

- calendar fetch failed
    
- invalid ICS
    
- no events found
    
- recurring events skipped or partially expanded
    
- timezone fallback used
    
- event missing UID
    
- event missing start date
    
- too many events truncated
    

This is where Calendar feeds can immediately reinforce your “feed reliability” direction.

---

# Phase 9: Add preview support

Current frontend preview posts form data to `/preview` and expects XML back. Extend the `/preview` backend route:

```ts
if (body.feedType === "calendar") {
  const calendarText = await fetchCalendarText(body.calendarUrl);
  const events = parseCalendarEvents(calendarText, getCalendarOptions(body));
  return c.text(buildRSSFromCalendarData(events, body));
}
```

The preview dialog can remain the same because the output is still RSS XML.

## Better calendar preview

After the MVP, add a structured event preview before XML preview:

```text
Found 24 events

| Start | Title | Location | Link | Status |
|---|---|---|---|---|
```

This gives users confidence before saving.

---

# Phase 10: Add URL detection

Add light detection in the UI and backend.

## Frontend detection

If user pastes a URL ending with:

```text
.ics
.ical
?format=ical
/basic.ics
/calendar.ics
```

show:

```text
This looks like a calendar feed. Switch to Calendar mode?
```

Do not silently switch.

## Backend detection endpoint later

Eventually add:

```text
POST /utils/analyze-source
```

Response:

```ts
{
  detectedType: "calendar",
  confidence: 0.95,
  reasons: [
    "URL ends with .ics",
    "Content-Type is text/calendar",
    "Body begins with BEGIN:VCALENDAR"
  ]
}
```

This should later support sitemap, RSS autodiscovery, JSON Feed, API JSON, and ordinary HTML.

---

# Phase 11: Add validation

Create validation before saving configs.

Calendar validation should check:

- URL exists
    
- URL protocol is `http` or `https`
    
- fetched content is not empty
    
- content contains `BEGIN:VCALENDAR`
    
- at least one `VEVENT` exists
    
- max events is reasonable
    
- window days is reasonable
    
- refresh time is reasonable
    

Recommended limits:

```text
calendarWindowDays: 1-730
calendarMaxEvents: 1-500
refreshTime: minimum 5 minutes unless manually overridden
```

For huge recurring calendars, recurrence expansion can become expensive. Guard against runaway recurrence.

---

# Phase 12: Add tests

Add unit tests around the calendar utility before tying everything into the UI.

## Test fixtures

Create:

```text
tests/fixtures/calendars/basic.ics
tests/fixtures/calendars/all-day.ics
tests/fixtures/calendars/recurring-weekly.ics
tests/fixtures/calendars/canceled.ics
tests/fixtures/calendars/categories.ics
tests/fixtures/calendars/timezone.ics
```

## Test cases

Minimum tests:

1. parses basic event
    
2. maps summary to title
    
3. maps description/location
    
4. filters future events
    
5. excludes past events by default
    
6. includes past events when enabled
    
7. excludes canceled events by default
    
8. includes canceled events when enabled
    
9. handles missing URL
    
10. generates stable GUID
    
11. recurring events get unique GUIDs
    
12. max events truncates output
    
13. sort order works
    

---

# Phase 13: Add docs

Update README with a Calendar Feeds section.

Suggested copy:

```md
## 📅 Calendar Feeds

Mkfd can generate RSS feeds from public iCalendar (`.ics`) URLs. This is useful for public event calendars, school calendars, community calendars, municipal meetings, release schedules, and other calendar-based sources.

Calendar feeds use structured event data instead of CSS selectors. You can choose how far ahead to look, whether to expand recurring events, how many events to include, and how event fields are mapped into RSS items.
```

Add examples:

```yaml
feedType: calendar
feedName: city-council-meetings
refreshTime: 60
calendar:
  url: https://example.gov/meetings.ics
  windowDays: 90
  includePastEvents: false
  expandRecurringEvents: true
  maxEvents: 50
  sortOrder: startAsc
  dateStrategy: start
  linkStrategy: eventUrl
```

---

# Suggested file changes

## Frontend

```text
frontend/src/types/feed.ts
frontend/src/components/forms/FeedBuilderForm.tsx
frontend/src/components/forms/CalendarForm.tsx
frontend/src/components/forms/FeedPreview.tsx
```

## Backend

```text
index.ts
utilities/calendar.utility.ts
utilities/rss-builder.utility.ts
workers/feed-updater.worker.ts
types/feed.ts or shared config type location
```

## Tests / fixtures

```text
tests/calendar.utility.test.ts
tests/rss-calendar-builder.test.ts
tests/fixtures/calendars/*.ics
```

## Docs

```text
README.md
.env.example if calendar-specific defaults are added globally
```

---

# Recommended implementation order

## Step 1: Types and config

- Add `calendar` feed type.
    
- Add calendar config fields.
    
- Add safe defaults.
    
- Make sure form submission can carry the new fields.
    

## Step 2: Parser utility

- Add `ical.js`.
    
- Create `calendar.utility.ts`.
    
- Parse events into normalized `CalendarEventItem`.
    
- Add fixture tests.
    

## Step 3: RSS builder

- Add `buildRSSFromCalendarData`.
    
- Generate valid RSS XML.
    
- Add GUID/date/link strategies.
    
- Add tests.
    

## Step 4: Preview endpoint

- Extend `/preview` to support `feedType === "calendar"`.
    
- Return RSS XML.
    
- Confirm frontend preview works without UI changes.
    

## Step 5: Calendar UI

- Add Calendar tab.
    
- Add `CalendarForm.tsx`.
    
- Wire defaults and fields.
    
- Hide all selector-related controls.
    

## Step 6: Worker support

- Add calendar branch to `feed-updater.worker.ts`.
    
- Write XML to `public/feeds`.
    
- Add error handling.
    

## Step 7: Health/logging hooks

- Record parse warnings and event counts.
    
- Store run result once health dashboard work exists.
    

## Step 8: Docs

- Add README docs.
    
- Add sample config.
    
- Add “Calendar feeds vs web scraping” explanation.
    

---

# MVP acceptance criteria

Calendar feed is complete when:

- User can select **Calendar** as feed type.
    
- User can enter a public `.ics` URL.
    
- User can choose lookahead days and max events.
    
- User can preview generated RSS.
    
- User can save the feed.
    
- Worker refreshes it on schedule.
    
- Generated items have stable GUIDs.
    
- Recurring event instances do not collide.
    
- Canceled events are excluded by default.
    
- Invalid calendar URLs produce useful errors.
    
- No CSS selector fields are shown in Calendar mode.
    

---

# Nice follow-up features

After MVP:

1. Calendar merge feeds
    
2. Calendar filter rules
    
3. Event change detection
    
4. Newly added event mode
    
5. Upcoming events mode
    
6. CalDAV support
    
7. Authenticated calendar URLs
    
8. Google Calendar helper
    
9. Microsoft 365 helper
    
10. ICS attachment extraction from email feeds
    
11. Calendar-to-webhook notifications
    
12. Calendar-to-JSON Feed output
    

---

# Strategic note

This is a very good Mkfd feature because it expands the app beyond “scraping webpages into RSS.” It reinforces the stronger positioning:

> Mkfd turns structured and messy sources into reliable feeds.

Calendar feeds also pair naturally with sitemap feeds, API feeds, email feeds, webhooks, and feed health monitoring. It is exactly the kind of source type that helps Mkfd become a feed generation platform rather than a FreshRSS clone.