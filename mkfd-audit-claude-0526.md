# Independent Audit — `major-revision-0526`

**Repo:** `D:/Projects/mkfd` · **Branch:** `major-revision-0526` (142 commits ahead of `main`)
**Diff scope:** 355 files, +90,421 / −4,014
**Auditor:** Claude Opus 5 (independent pass; Codex's audit not consulted)
**Date:** 2026-09-01

---

## 1. Scope and method

Read-only static audit of the branch diff, weighted toward the front end per the brief. Coverage:

- All 11,440 lines of `frontend/src` (every `.tsx`, `.ts`, `.css` file read or targeted-scanned)
- `frontend/` build config, `index.html`, Playwright config and all 5 e2e specs
- `index.ts`, all 12 files in `routes/`, `utilities/source-assistant/**`, `utilities/app-settings.utility.ts`, `utilities/config-manager.utility.ts`
- Cross-file consistency sweeps (ARIA inventory, hex-colour inventory, `as any` census, duplicate-constant tracing)
- WCAG contrast ratios computed numerically for 25 colour pairs taken from the source

Every finding below cites `file:line`. Findings are labelled **[NEW]** (introduced by this branch) or **[PRE-EXISTING]** (inherited from `main`, verified via `git show main:<path>`). Unlabelled findings are new to the branch.

> **Note on tooling:** the brief asked for the `impeccable` skill. It is not installed in this environment (`~/.claude/skills` is empty; no plugin provides it). This audit therefore uses my own front-end review methodology. Worth installing before the next pass if you want its specific checklist applied.

---

## 2. Severity summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| C1 | **Critical** | Sandboxed proxy iframe grants third-party JS full same-origin access to the app | `SelectorPlayground.tsx:137` **[PRE-EXISTING]** |
| C2 | **Critical** | Auth middleware fails open and treats all reverse-proxied traffic as local | `index.ts:146-152` **[PRE-EXISTING]** |
| H1 | **High** | "Undo" on feed delete is fake — restores UI only, server delete already committed | `MyFeedsPage.tsx:186-192` |
| H2 | **High** | Source Assistant progress checklist is simulated on a 400 ms timer | `SourceAssistantPanel.tsx:185-190` |
| H3 | **High** | `starter-configs/` is a fake plugin architecture — 9 adapter files are alias re-exports | `utilities/source-assistant/starter-configs/*.adapter.ts` |
| H4 | **High** | Applying any non-scrape/API/feed recommendation produces a dead builder | `starter-configs/index.ts:56-62` + `BuildFeedPage.tsx:59-65` |
| H5 | **High** | Calendar recommendations open the **Email/IMAP** builder | `BuildFeedPage.tsx:63` |
| H6 | **High** | Actions-menu items likely never fire (outside-click closes portal on `mousedown`) | `FeedActionsMenu.tsx:19-25` |
| H7 | **High** | Toast context value unmemoised → every toast triggers 2 full feed refetches | `toast-provider.tsx:20` + `MyFeedsPage.tsx:46-59` |
| H8 | **High** | Header Publish/Save button never disables → double-submit creates duplicate feeds | `BuildFeedPage.tsx:175-181` |
| H9 | **High** | Feed detail drawer is not a dialog — no focus trap, no Escape, no focus restore | `FeedDetailDrawer.tsx:50-89` |
| H10 | **High** | Default secondary text colour fails WCAG AA (4.34:1) app-wide | `index.css:18` |
| H11 | **High** | 13 `alert()` calls used as the primary success/error channel | 5 files |
| H12 | **High** | Health and Settings are unreachable below the `lg` breakpoint | `Sidebar.tsx:41` + `BottomNav.tsx` |
| H13 | **High** | Draft autosave leaks `webhookToken` / `serviceConnectorApiKey` to localStorage | `useFeedDraft.ts:12-25` |
| H14 | **High** | No error boundary anywhere — one render throw blanks the app | `App.tsx`, `main.tsx` |
| M1–M38 | Medium | See §4–§10 | — |
| L1–L3 | Low | See §4, §9 | — |

---

## 3. Headline metrics

These numbers characterise the branch better than any prose:

| Metric | Value | Comment |
|---|---|---|
| ARIA attributes in 11,440 lines of front end | **34** (30 `aria-label`, 2 `aria-hidden`, 2 `aria-checked`) | Zero `aria-live`, `aria-expanded`, `aria-pressed`, `aria-current`, `aria-invalid`, `aria-describedby`, `aria-selected`, `aria-busy`, `aria-modal`, `aria-sort` |
| `role=` attributes | **2** (both `role="switch"`) | No `dialog`, `tablist`, `status`, `alert`, `menu`, `group` |
| Hard-coded 6-digit hex colours | **120** across 14 files | In a codebase shipping *three* token systems |
| Inline `style={{}}` objects | **~370** across 20 files | Alongside Tailwind, in the same elements |
| `as any` (front end) | **73** | Under `"strict": true` |
| `as any` / `: any` (back end) | **227** | — |
| `alert()` calls | **13** | `confirm()` calls: **0** |
| `console.*` (back end) | **118** | No structured logging |
| Decorative `// ---` banner comments | **98** (24 FE + 74 BE) | Restating the symbol name below them |
| Error boundaries / `Suspense` / `React.lazy` | **0** | — |
| `AbortController` usages | **1** | Across 33 `fetch` call sites |
| Distinct copies of the feed-type label map | **7** | See M1 |
| Production JS bundle | **944 KB** uncompressed, single chunk | `manualChunks: undefined` explicitly disables splitting |
| e2e tests | 5 specs / ~137 lines / Chromium-desktop only | For a +90k-line change |

---

## 4. AI code smells

### H3 — `starter-configs/` is architecture theatre

`utilities/source-assistant/starter-configs/` contains ten files. Nine of them are **one line each**:

```ts
// calendar.adapter.ts — the entire file
export { buildStarterConfig as buildCalendarStarterConfig } from "./index";
// graphql.adapter.ts — the entire file
export { buildStarterConfig as buildGraphqlStarterConfig } from "./index";
// …and 7 more, identical but for the alias
```

There are no per-route adapters. All nine alias the *same* function in `index.ts:3`, which is a single `if`-chain handling 3 of 10 route types plus a generic fallback. The directory exists to look modular. Delete all nine files and import `buildStarterConfig` directly.

The sibling `scorers/` directory has the same character: seven of ten scorers are a single ternary expression, and `service-connector.scorer.ts` is the complete file:

```ts
export const scoreServiceConnector: SourceAssistantScorer = () => null;
```

A scorer that never scores, registered in the pipeline.

### H2 — Simulated progress

`SourceAssistantPanel.tsx:8-21` defines a 12-step analysis checklist ("Checking for sitemaps", "Sampling detail pages", "Reading detail-page JSON-LD"…). `SourceAssistantPanel.tsx:185-190`:

```ts
// Simulate step progression while waiting for the backend
let step = 0;
const stepInterval = setInterval(() => {
  step = Math.min(step + 1, ANALYSIS_STEPS.length - 2);
  setAnalysisStep(step);
}, 400);
```

The checklist has **no relationship to backend progress**. The comment says so. Consequences beyond the honesty problem:

- A sub-400 ms response jumps from step 0 straight to done, so the user never sees the feature work.
- A slow response parks permanently on step 10 ("Suggesting CSS selectors"), falsely implicating a specific stage in the hang.
- `stepInterval` is never cleared on unmount (`:186`) — leaks, and calls `setState` after unmount if the user navigates away mid-analysis.
- `catch (err: any) { clearInterval(stepInterval); }` (`:196-198`) silently discards the error.

Either stream real progress (SSE — the app already has an `EventSource` pattern in `useHealthStream.ts`) or show an honest indeterminate spinner.

### M2 — Unearned precision in confidence scores

`ConfidenceMeter` (`SourceAssistantPanel.tsx:39-57`) renders a percentage bar: "74% — Medium confidence". The 74% comes from `scorers/graphql.scorer.ts`:

```ts
export const scoreGraphql: SourceAssistantScorer = (obs) =>
  obs.finalUrl.toLowerCase().includes("graphql") ? { …confidence: 0.74… } : null;
```

A hard-coded decimal attached to a substring match. Every scorer does this (`0.8`, `0.74`, `0.45`, `0.25`, `0.2`). Presenting these to two significant figures behind a meter implies calibration that does not exist. Either derive the number from evidence or show a three-band label without the percentage.

### M3 — Calendar scorer is broken in both directions

`scorers/calendar.scorer.ts:2`:

```ts
/ical|ics|calendar/i.test(obs.contentType ?? obs.finalUrl)
```

- **False negatives:** when `contentType` is present it is tested *instead of* the URL. A real `.ics` file served as `text/plain` or `application/octet-stream` is never matched.
- **False positives:** when `contentType` is absent, `ics` matches inside ordinary paths — `/topics/`, `/politics/`, `/physics/`, `/graphics/` all return "Use calendar feed" at **0.8 confidence**, which makes it the top recommendation.

Anchor the URL test to an extension/path segment and test both fields.

### H4 + H5 — Applying a recommendation is broken for 6 of 10 route types

Two independent defects compound:

1. `starter-configs/index.ts:56-62` — the fallback branch returns `{ feedType: recommendation.routeType, feedName, sourceUrl: … }`. But `sourceUrl` is not a field any form reads (every form uses `feedUrl`), and `routeType` values `changeDetection` / `manual` are not members of `FeedFormData["feedType"]` (`types/feed.ts:353`).
2. `BuildFeedPage.tsx:59-65` — `APPLY_TYPE_MAP` has entries only for `existingFeed`, `webScraping`, `restApi`, `calendar`, `manual`; everything else hits `?? "webScraping"` (`:116`).

Net effect: applying a **sitemap**, **GraphQL**, **change-detection**, **service-connector** or **manual** recommendation drops the user into an empty Web Scraping builder with no source URL.

And **H5**, the sharpest instance, is a one-token copy-paste error at `BuildFeedPage.tsx:63`:

```ts
calendar: "email",
```

A calendar recommendation opens the **Email/IMAP** builder. A `calendar` feed type exists (`TypePickerGrid.tsx:78`).

### M4 — `buildFeedConfigFromFormData` is a no-op with a triple cast

`lib/feed-config-builder.ts` in full — 10 lines, 3 of them comments explaining that it does nothing:

```ts
export function buildFeedConfigFromFormData(data: FeedFormData): Record<string, unknown> {
  // The backend caster already handles all field mapping from FeedFormData.
  // We just send the data as-is since the caster was written to accept FeedFormData shape.
  // This function exists as the explicit boundary — future transformations go here.
  return data as unknown as Record<string, unknown>;
}
```

The consequence is not cosmetic. `FeedBuilderForm.tsx:59-123` seeds `defaultValues` with defaults for **all ten feed types simultaneously**. Because this function passes everything through, creating an *email* feed POSTs `graphqlItemPath: "data.items"`, `sitemapMaxItems: 50`, `serviceConnectorService: "jellyfin"`, `filesystemInclude: "*"`, `webhookRetentionDays: 30` and ~30 more irrelevant keys, which are then persisted into the feed's YAML.

Additionally, `sourceAssistantAnalysis: { observation, recommendation }` (`starter-configs/index.ts:51`) is stuffed into form state, so the entire page observation — potentially including fetched HTML — is written into the feed config **and** into localStorage by the draft hook.

### M5 — `active: true` on every entry gates ~20 lines of unreachable code

`TypePickerGrid.tsx:14-139` — all ten feed types are declared `active: true`. Yet the component ships:

- `disabled={!type.active}` (`:160`)
- `type.active && onSelect(type.id)` (`:159`)
- `cursor: type.active ? "pointer" : "not-allowed"` (`:173`)
- `opacity: type.active ? 1 : 0.6` (`:176`)
- an entire `{!type.active && <span>SOON</span>}` badge block (`:185-194`)
- three more ternaries on `type.active` in the style object

None of it can execute. This is scaffolding for a state that never occurs.

### M1 — Seven copies of the feed-type label map, three copies of the icon set

| Location | Form |
|---|---|
| `feeds/FeedTypeBadge.tsx:11` | `TYPE_META` — label + bg/color/border |
| `builder/TypePickerGrid.tsx:14` | `FEED_TYPES` — label + description + identical bg/color/border |
| `pages/MyFeedsPage.tsx:27` | `TYPE_LABELS` |
| `pages/BuildFeedPage.tsx:45` | `TYPE_LABELS` (different keys) |
| `forms/DraftRestoreDialog.tsx:8` | `FEED_TYPE_LABELS` |
| `forms/FeedBuilderForm.tsx:333-342` | inline `&&` ladder + nested ternary |
| `pages/health/FeedHealthTab.tsx:69` | raw `feed.feedType` |

The eight `<svg>` icons in `FeedTypeBadge.tsx:22-66` are **byte-identical** to those in `TypePickerGrid.tsx` (only `width`/`height` differ) — and `lucide-react` is already a dependency providing all eight. `FeedBuilderForm.tsx:29` even imports the lucide equivalents (`Globe`, `Code`, `Mail`, `Map`, `CalendarDays`, `Boxes`, `Webhook`, `FolderOpen`) for a *third* rendering of the same concept.

**M1a — this duplication has produced two live bugs:**

- `FeedBuilderForm.tsx:342` — the nested ternary names only 4 of 10 types and falls through to the raw id. The Basic section badge literally reads **"serviceConnector"**, **"graphql"**, **"filesystem"** to the user. `serviceConnector` also gets no icon (`:333-341` has no branch for it).
- The builder's type vocabulary (`webScraping`, `api`, `feedTransformer`, `serviceConnector`) diverges from `FeedType` in `types/feed-summary.ts:3` (`scrape`, `rest`, …), which has no member for `feedTransformer` or `serviceConnector`. `FeedTypeBadge.tsx:75` silently falls back: `TYPE_META[type] ?? TYPE_META.scrape`. A Feed Transformer feed therefore renders in My Feeds as a **blue globe labelled "Scrape"**.

### M6 — Two identical `Switch` components, neither from the UI kit

`settings/SettingRow.tsx:78-110` (`InlineSwitch`) and `pages/health/SettingsTab.tsx:33-58` (`Switch`) are the same component with byte-identical Tailwind class strings. `components/ui/` has `checkbox.tsx` but no `switch.tsx`, and `@radix-ui/react-checkbox` is installed. The `SettingsTab` copy also has **no accessible name** — no `aria-label`, no `id`/`Label` pairing — so it announces as "switch, on" with no indication of what it toggles.

### M7 — Dead code and dead API surface

| Item | Location | Evidence |
|---|---|---|
| `hide-scrollbar` class | `ScrollableFilterRow.tsx:63` | Defined nowhere. WebKit still paints the global 8 px scrollbar (`index.css:249`) inside the filter row. |
| `.gradient-border` | `index.css:195-201` | 0 usages. Still carries the pre-redesign orange gradient `#f97316 → #dc2626`. |
| `.slide-up`, `.slide-down` | `index.css:186-192` | 0 usages. |
| `--chart-1` … `--chart-5` | `index.css:27-31, 70-74` | Defined light+dark; 0 usages. All chart colours are hard-coded hex. |
| `isStale`, `setLastUrl` | `useSourceAssistant.ts:13, 42` | Exported from the hook, consumed by nothing. The whole staleness concept is built and never wired. |
| `onPickType` prop | `SourceAssistantPanel.tsx:175` | Destructured as `_onPickType` and discarded — while `BuildFeedPage.tsx:218` actively passes it a real handler. |
| `hint` prop | `builder/Field.tsx:7` | 0 usages across 36 `<Field>` call sites. |
| `FeedTable` empty state | `FeedTable.tsx:120-124` | Unreachable — `MyFeedsPage.tsx:362` short-circuits on `filtered.length === 0` before rendering the table. |
| `POST /delete-feed` | `routes/feeds.ts:492` | Legacy duplicate of `DELETE /api/feeds/:id` (`:474`), using a *different* sanitiser (`basename()` vs `assertSafeFeedId()`). Front end uses the REST one. |
| `src/assets/graphql.svg`, `sitemap.svg` | added in diff | Never imported. |
| `zod` ^3.24.1, `@hookform/resolvers` ^3.9.1 | `frontend/package.json` | **Zero imports.** An abandoned validation plan left in the manifest. |
| `readline` ^1.3.0, `bun` ^1.1.33 | `package.json` deps | `readline` is a Node builtin (the npm package is a deprecated stub); `bun` is the runtime, not a dependency. `bun-types` (deps) duplicates `@types/bun` (devDeps). `@types/xml` present with no `xml` package. |

### M8 — Defensive fallbacks on exhaustive unions

`TYPE_META[type] ?? TYPE_META.scrape` (`FeedTypeBadge.tsx:75`), `STATUS_META[status] ?? STATUS_META.neverRun` (`FeedStatusBadge.tsx:25`), `BAND_META[band] ?? BAND_META.low` (`SourceAssistantPanel.tsx:40`). All three index a `Record<Union, T>` with a value of that exact union type — the `??` branch is unreachable *by the type system*, and it actively hides the real bug in M1a by mislabelling unknown types instead of failing loudly.

### M9 — Boilerplate that should be a loop

`FeedBuilderForm.tsx:218-239` enumerates **19 fields** by hand to coerce `undefined → ""`:

```ts
descriptionSelector: formData.descriptionSelector || "",
descriptionAttribute: formData.descriptionAttribute || "",
linkSelector: formData.linkSelector || "",
…16 more identical lines
```

### M10 — Error handling by string-matching exception messages

`routes/feeds.ts:394-490` — five consecutive handlers, each closing with an identical block:

```ts
} catch (e: any) {
  if (e?.message?.includes("not found")) return ctx.json({ error: e.message }, 404);
  if (e?.message?.includes("Invalid feedId")) return ctx.json({ error: e.message }, 400);
  return ctx.json({ error: "Internal error" }, 500);
}
```

Duplicated 5×, and any internal error whose message happens to contain "not found" is mapped to a 404. Note also that `GET /api/feeds/:id/config` (`:242-248`) validates inline with `assertSafeFeedId` while its five siblings delegate and string-match — **two validation strategies in one file.**

### L1 — Comment archaeology

- `index.css:246`: `/* Enhanced Focus States - Removed to avoid conflicting with shadcn's focus-visible styles */` — a comment describing a deletion.
- `MyFeedsPage.tsx:190`: `// No backend undo — just restore UI state` — see H1.
- `SettingsPage.tsx:348`: `{/* Floating save affordance for long pages */}` — the element is a static flex row in normal document flow. Not floating.
- `frontend/e2e/feeds.spec.ts:7-8`: `// Instead of waiting for text that might be slow to render, / let's wait for the "Web Scraping" button…` — the author's reasoning process, committed.
- `useHealthStream.ts:107-109`: `source.onerror = () => { /* Browser will auto-reconnect on error; no action needed */ }` — true only for transient errors; see M22.

---

## 5. Correctness and interaction defects

### H1 — Fake undo on a destructive action

`MyFeedsPage.tsx:177-203`:

```ts
const toastId = toast.push({
  title: `"${feed.title}" deleted`,
  action: { label: "Undo", onClick: async () => {
      setFeeds(prev);
      // No backend undo — just restore UI state
  }},
});
try {
  const res = await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
```

The DELETE fires immediately. Clicking Undo re-inserts the row into local state only; the feed is gone from disk and vanishes on the next reload. The user is told an irreversible action was reversed.

Compounding: **there is no confirmation dialog** — `FeedActionsMenu.tsx:87` → `handleAction("delete")` is one click, no `confirm()`, no typed-name gate. There are **zero `confirm()` calls in the entire front end**.

Fix: either (a) implement soft-delete with a real restore endpoint and keep the undo toast, or (b) hold the DELETE for the toast duration and fire it on dismissal, or (c) drop the undo and add a confirmation. (a) is the right answer for a tool where a feed config represents real configuration effort.

### H6 — Actions menu items probably never fire

`FeedActionsMenu.tsx:17-25`:

```ts
const handler = (e: MouseEvent) => {
  const target = e.target as Node;
  if (triggerRef.current && !triggerRef.current.contains(target)) setOpen(false);
};
document.addEventListener("mousedown", handler);
```

The menu is rendered through `createPortal` into `document.body` (`:68-90`), so menu items are **not** inside `triggerRef`. Pressing the mouse on "Delete" fires `mousedown` → handler → `setOpen(false)` → React flushes before the browser dispatches `click` (separate tasks) → the button is unmounted → its `onClick` never runs.

Standard fix: hold a ref on the portal content and exclude it from the outside-click test, or listen on `click` instead of `mousedown`. **Verify by hand before shipping** — if items do fire, the menu at minimum closes on any press inside its padding.

Same component, further problems:
- Position is computed once on open (`:29-30`) with `position: fixed`. It does not reposition on scroll or resize, so the menu detaches from its row the moment the list scrolls, and near the viewport bottom it is clipped off-screen with no collision handling.
- No `role="menu"` / `menuitem`, no `aria-haspopup`, no `aria-expanded`, no Escape handler, no arrow-key navigation, no focus move or restore. `@radix-ui/react-dropdown-menu` is not a dependency although six other Radix primitives are.
- Hover is implemented by mutating inline styles in `onMouseEnter`/`onMouseLeave` (`:45-46`), so keyboard focus produces no highlight at all.

### H7 — Every toast triggers two full feed refetches

`toast-provider.tsx:20`:

```tsx
<Ctx.Provider value={{ push, dismiss }}>
```

A fresh object literal on every render, never memoised. `push`/`dismiss` are `useCallback`-stable but the *value object* is not. Then `MyFeedsPage.tsx:46-59`:

```ts
const loadFeeds = useCallback(async () => { … }, [toast]);
useEffect(() => { loadFeeds(); }, [loadFeeds]);
```

Chain: `ToastProvider` re-renders (on every push **and** on every auto-dismiss 4.2 s later) → new context value → `toast` identity changes → `loadFeeds` identity changes → effect re-runs → `GET /api/feeds`. So every toast costs two extra full-list fetches, and the list flickers back to server state ~4 s after any optimistic update.

Fix: `useMemo(() => ({ push, dismiss }), [push, dismiss])` in the provider. Worth auditing all consumers of `useToast()` in dependency arrays afterwards.

### H8 — Double-submit creates duplicate feeds

`BuildFeedPage.tsx:175-181` renders the primary Publish/Save button, which calls `formRef.current?.submit()` through an imperative handle. It has **no `disabled` state** and no knowledge of `isSubmitting`, which lives in `FeedBuilderForm.tsx:55`. The *in-form* duplicate button (`FeedBuilderForm.tsx:447-463`) is correctly disabled — but it is gated behind `show("output")` (`:435`), so on every step except the last, the header button is the only one and it is unguarded. Two clicks → two `POST /` → two feeds.

Related: the two submit affordances use **different labels for the same action** — header says "Publish"/"Save", in-form says "Submit"/"Update Feed".

### M11 — Render-loop risk from unnamed `watch()`

`FeedBuilderForm.tsx:143, 156` call `watch()` with no arguments (three times total, including line 143's `(watch() as any)`), then feed the result into effect dependency arrays:

```ts
const formValues = watch();
useEffect(() => { if (isDirty) saveDraft(formValues, …); }, [formValues, …]);   // :157-161
useEffect(() => { onValuesChange?.(formValues); }, [formValues, onValuesChange]); // :164-166
```

`onValuesChange` is `setFormValues` from `BuildFeedPage.tsx:238`. Parent state update → parent re-render → child re-render → new `watch()` object → effect re-fires → parent state update. Whether this terminates depends on RHF internals returning a referentially stable object; it is the canonical RHF footgun and should not be relied on. Even in the benign case, **every keystroke re-renders the entire builder tree including the preview panel**. Use `watch((values) => …)` subscription form or `useWatch` with named fields.

### M12 — Step navigation shows CSS-selector steps for Sitemap, Webhook, Filesystem, GraphQL, Calendar

`BuildFeedPage.tsx:67-72`:

```ts
function getSections(type: string): SectionDef[] {
  if (type === "api") return SECTIONS_API;
  if (type === "email") return SECTIONS_EMAIL;
  if (type === "feedTransformer") return SECTIONS_TRANSFORMER;
  return SECTIONS_SCRAPE;   // ← 6 of 10 types land here
}
```

`SECTIONS_SCRAPE` is `Basic → Headers & Cookies → Selectors → Output → Advanced`. A Sitemap or Webhook feed presents a "Selectors" step that does not apply to it. Combined with `FeedBuilderForm`'s `show(id)` gating (`:144`), those steps render an empty panel.

### M13 — Duplicate/dead branches in `handleAction`

`MyFeedsPage.tsx:107-115` — the `"open"` and `"preview"` cases are byte-identical (`window.open('/public/feeds/${feed.id}.xml')`). The menu offers both "Open RSS" and "Preview" as separate items (`FeedActionsMenu.tsx:77, 79`) that do exactly the same thing.

### M14 — Clipboard and download operations are unchecked

- `MyFeedsPage.tsx:111` — `navigator.clipboard.writeText(...)` is not awaited and has no `.catch()`; the "Feed URL copied" toast fires unconditionally, including in non-secure contexts and when permission is denied.
- `FeedDetailDrawer.tsx:30` — the same call with **no feedback at all**. The user presses "Copy" and nothing visible happens. Inconsistent with the toast on the other path.
- `MyFeedsPage.tsx:136-141` — export creates an `<a>`, never appends it to the DOM, and calls `URL.revokeObjectURL(url)` **synchronously after `a.click()`**. This races the download and is known to cancel it in Firefox. Append to `document.body`, click, then revoke in a `setTimeout`.

### M15 — Unhandled promise rejections silently blank the charts

`pages/health/OverviewTab.tsx:37-71` and `FeedHealthTab.tsx:14-18` both use bare `.then().then()` with **no `.catch()`**. A failed or malformed `/api/health/runs` response produces an unhandled rejection and leaves the charts permanently empty with no error state and no loading state — indistinguishable from "no data".

### M16 — Chart day-grouping loses ordering and collides across years

`OverviewTab.tsx:46-55` buckets runs by `new Date(row.startedAt).toLocaleDateString("en-US", {month:"short", day:"numeric"})` and then emits `Object.values(byDay)` — insertion order, i.e. **the API's row order**. If rows arrive newest-first the x-axis runs backwards in time. `"Jan 5"` from two different years collapses into one bucket. Group by ISO date and sort explicitly.

Also `?pageSize=200` (`:38`) silently truncates the window with no indication to the user of what period is shown.

### M17 — N+1 requests on the Feed Health tab

`FeedHealthTab.tsx:12-18` mounts one `<Sparkline>` per feed, each firing its own `GET /api/health/chart/:feedId`. Fifty feeds = fifty requests on tab open. Batch into one endpoint.

### M18 — Optimistic metadata updates never verify the response

`MyFeedsPage.tsx:85-103` — `handleUpdate` PATCHes and never checks `res.ok`. A 500 resolves the promise, the `catch` never runs, and the optimistic UI change persists as if saved. (The `catch` also comments `// Revert` and then calls `loadFeeds()`, which is a refetch, not a revert — and `e` is bound but unused.)

### M19 — Filter arrows go stale

`ScrollableFilterRow.tsx:20-31` attaches a `ResizeObserver` to the **scroll container**, whose box is `flex: 1` and does not change when its children do. When tags/types load asynchronously, `scrollWidth` grows but no callback fires, so `canScrollRight` stays `false` and the right arrow never appears. Observe the content wrapper, or recompute on children change.

Separately, the arrows mount and unmount inside the flex row (`:44`, `:67`), so the chip strip **shifts horizontally** the instant scrolling begins. Reserve the space.

### M20 — Search will throw on incomplete data

`MyFeedsPage.tsx:67` — `f.sourceUrl.toLowerCase()`. `sourceUrl` is non-optional in `types/feed-summary.ts:12`, but it is derived server-side from feed configs of ten different shapes; any feed type that doesn't produce one yields `undefined` and throws during filtering. With **no error boundary (H14)** this blanks the whole application.

Search also matches only `title` and `sourceUrl` — not tags, despite tags being a first-class filter dimension.

### M21 — Filter and view state are ephemeral and unshareable

`MyFeedsPage.tsx:39-44` — search, quick filter, type filters, tag filters and card/table view all live in component state. Not in the URL, not persisted. A refresh loses everything and a filtered view cannot be shared or bookmarked. (Note the inconsistency: sidebar collapse *is* persisted to localStorage at `Sidebar.tsx:13`.)

### M22 — Health stream dies silently

`useHealthStream.ts:107-109` sets an empty `onerror` with a comment asserting the browser auto-reconnects. That holds for transient drops; on a fatal error (non-2xx, wrong content type) `EventSource` sets `readyState = CLOSED` and **does not** reconnect. The dashboard then displays stale data indefinitely with no "disconnected" indicator.

Also `:93` — `onRunRef.current = onRun` is assigned **during render**, a side effect in the render body that misbehaves under StrictMode double-rendering. Move it into an effect.

### M23 — Missing abort and timeout on every request

One `AbortController` across 33 `fetch` sites. `lib/source-assistant-client.ts` has no `signal` and no timeout on any of its three calls — including `/source-assistant/analyze`, which performs server-side remote fetching and can run for a long time. Navigating away mid-analysis leaves the request in flight and calls `setState` on an unmounted tree.

### L2 — Miscellaneous

- `BuildFeedPage.tsx:164` — the breadcrumb shows the raw feed **id** in edit mode (`Edit: a3f9c1`), not the feed title. `BuildFeedPage.tsx:161` — "Feeds" in the breadcrumb is a `<span>`, not a link.
- `MyFeedsPage.tsx:360` shows the bare text `"Loading feeds..."`; `SettingsPage.tsx:233` uses `<LoadingSpinner>`; `OverviewTab` shows nothing. **Three different loading treatments** across three pages.
- The stat tiles (`MyFeedsPage.tsx:242-252`) render `0 / 0 / 0 / 0` during load, which reads as "you have no feeds" before data arrives.
- `FeedTable.tsx:17` — `<th className="workbench-table th">`. `th` is being used as a class name; the intent was the descendant selector `.workbench-table th`. It also re-applies `width: 100%` from `.workbench-table` to each header cell.
- `FeedTable` has **no column sorting at all** on the primary list view.
- `FeedTable.tsx:61, 73` renders `FeedTypeBadge` **twice per row** — icon-only in the Name cell and again with a label in the Type cell.
- `builder/Field.tsx:21` — `required !== undefined` makes `required` a three-state prop: `true` → "required" pill, `false` → "optional" pill, omitted → nothing. Easy to get wrong, and inconsistently applied across 36 call sites.
- `SettingsPage.tsx:223-301` — three near-identical page shells (loading / error / loaded), each re-declaring the `<div>/<header>/<h1>Settings</h1>` markup.
- `SettingsPage.tsx:169` — dirty comparison is `orig !== curr`. Numbers arrive from JSON as `number` but return from `<input type="number">` as `string`; `5 !== "5"` leaves a field permanently dirty. Depends on `SettingRow`'s coercion — verify.
- Neither the builder nor Settings guards navigation on unsaved changes. `SettingsPage` tracks `isDirty` and does nothing with it; `BuildFeedPage.tsx:103-110` discards a half-built feed on one click with no confirmation.
- `useFeedDraft.ts:48-64` — the debounced `saveDraft` closes over `draftKey`; changing feed type mid-build lets a pending timer write to the *old* key. No timer cleanup on unmount, no TTL on `savedAt`, and drafts accumulate one localStorage entry per feed type forever.

---

## 6. Accessibility

The ARIA/role census in §3 is the headline: 34 ARIA attributes and 2 roles across the whole front end. Specific failures, roughly by impact:

### H9 — The feed detail drawer is not a dialog

`FeedDetailDrawer.tsx:50-89` renders a scrim `<div onClick>` and a `position: fixed` panel. It has **no** `role="dialog"`, `aria-modal`, focus trap, focus-on-open, focus restore on close, or Escape handler. Background content is not inert, so Tab walks behind the drawer into the page underneath. The `↗` external-link button (`:35-42`) has no accessible name at all.

The app already uses `@radix-ui/react-dialog` in `ui/dialog.tsx` and `FeedPreview` — this drawer should use it.

### H10 — Default secondary text fails WCAG AA

Computed contrast ratios (sRGB, WCAG 2.x):

| Pair | Ratio | Verdict |
|---|---|---|
| `--muted-foreground` `hsl(204 9% 47%)` on `--background` | **4.34:1** | **FAIL** (needs 4.5) |
| `--wb-outline` `#c3c7cb` on `--wb-card` `#ffffff` | **1.70:1** | **FAIL** (needs 3.0 for UI boundaries, WCAG 1.4.11) |
| `.workbench-chip-success` `#7a8a5f` on its 14 % tint, 10 px/700 | **3.17:1** | **FAIL** |
| `.workbench-chip-error` `#b25555` on its 14 % tint, 10 px/700 | **3.96:1** | **FAIL** |
| `--wb-success` `#7a8a5f` on card, at body sizes | **3.73:1** | **FAIL** |
| `--wb-warning` `#8c7f50` on card, at body sizes | **3.99:1** | **FAIL** |
| Toast body text `rgba(255,255,255,.7)` on `#166534` | **3.40:1** | **FAIL** |
| Toast close `×` `rgba(255,255,255,.5)` on `#991b1b` | **2.47:1** | **FAIL** |
| `FeedStatusBadge` "disabled" `#64748b` on `#f1f5f9`, 11 px | **4.34:1** | **FAIL** |
| Favourite star `#f59e0b` on white (UI icon, needs 3.0) | **2.15:1** | **FAIL** |
| `FeedStatusBadge` healthy / warning / error / running | 7.80 / 7.78 / 7.78 / 6.97 | pass |
| `FeedTypeBadge` all eight | 8.07 – 9.45 | pass |
| `--wb-muted` on `--wb-surface` | 8.89 | pass |

`--muted-foreground` and `--wb-outline` are the two highest-leverage fixes — they are the app's default secondary-text and border colours, used on essentially every screen. Darkening `--muted-foreground` to ~`hsl(204 9% 40%)` and `--wb-outline` to ~`#9aa0a6` clears both.

Note the stat tiles at `MyFeedsPage.tsx:250` render `--wb-success`/`--wb-warning` at 28 px/650, which qualifies as large text (3:1) and passes — but the same tokens fail everywhere else they appear.

### H12 — Health and Settings are unreachable on small screens

`Sidebar.tsx:41` — `className="hidden … lg:flex"`. `BottomNav.tsx` offers exactly three destinations: Feeds, Create, Catalog. Below 1024 px, `/health` and `/settings` can only be reached by typing the URL. This includes every tablet in portrait.

`BottomNav` also has no visible active state for the centre Create button (it's a plain `<button>` navigating to `/`, not a `NavLink`), and its labels are `text-[10px]` (`:21, :41`).

### H11 — `alert()` as the primary feedback channel

13 calls across 5 files, in an app that ships a `ToastProvider`:

| Location | Use |
|---|---|
| `FeedBuilderForm.tsx:187, 193` | **Success** confirmation, with feed URLs formatted using `\n\n` inside a native modal the user cannot copy from conveniently |
| `FeedBuilderForm.tsx:200, 205, 257, 261, 286` | Errors, including a `\n`-joined list of server validation errors |
| `EmailForm.tsx:45, 68` | Validation and connection errors |
| `SelectorPlayground.tsx:43, 57` | Validation errors |
| `SelectorPlayground.tsx:61` | `alert('Set ${fieldName} to: ${currentSelector}')` — an **alert used as a success toast** |
| `SourceAssistantPanel.tsx:212` | Apply error |

`alert()` blocks the main thread, cannot be styled or dismissed programmatically, is announced inconsistently by screen readers, and is suppressible by browsers. Route all of these through `useToast()`.

### M24 — Toasts are invisible to screen readers

`toast-provider.tsx:22` — the toast container has no `role="status"` / `role="alert"` and no `aria-live`. Every success and failure message in the app is silently invisible to assistive technology. The dismiss `×` button (`:30`) has no `aria-label`. There is **zero `aria-live` in the entire front end.**

The container is also positioned `bottom: 20, right: 20` (`:22`), directly on top of the `BottomNav` on mobile.

### M25 — Selection state is never exposed

- Quick-filter chips (`MyFeedsPage.tsx:285-299`) are mutually exclusive and carry no `aria-pressed`, no `role="radio"`/`radiogroup`, no `aria-current`. Selection is conveyed by background colour and font weight only.
- Type and tag toggle chips (`:316-330`, `:339-353`) — no `aria-pressed`.
- Card/table view toggle (`:263-278`) — no `aria-pressed`.
- Builder step tabs (`BuildFeedPage.tsx:187-206`) are styled and labelled as a tablist ("Step 01 / Basic") but use no `role="tablist"`/`tab`, no `aria-selected`, no `aria-controls`, no arrow-key navigation, and the panel has no `role="tabpanel"`.
- `Sidebar.tsx:94-143` — in collapsed mode the nav items become `<button onClick={navigate}>` instead of `NavLink`, which loses `aria-current`, `href` semantics, middle-click, and open-in-new-tab. The expanded branch (`:147-162`) uses `NavLink` and gets all of it. Two different implementations of the same nav, with different behaviour.

### M26 — Click targets that keyboards cannot reach

- `FeedTable.tsx:22-26, 59` — the row-detail affordance is `<td onClick>`. Not focusable, no role, no key handler. The drawer is unreachable by keyboard.
- `FeedHealthTab.tsx:57-61` — `<Card onClick>` with `cursor-pointer`, same problem, for the entire feed-health list.
- Additionally the table's clickable area is only the Name cell, so the pointer affordance appears over one cell of a row that visually reads as one unit.

### M27 — Unlabelled and unassociated form controls

- `builder/Field.tsx:16` — `htmlFor` is **optional**. Nine `<Field>` call sites omit it (all in `ExistingFeedTransformerForm.tsx:166, 199, 214, 253, 256, 264, 267, 270, …`), producing `<label>` elements bound to nothing. Make `htmlFor` required.
- `Field.tsx:37-41` — `hint` renders as a plain div with no `aria-describedby` link. (Moot today: 0 usages.)
- `Field.tsx:21-34` — the "required" pill is purely visual; no `required` or `aria-required` reaches the input.
- `MyFeedsPage.tsx:220-226` — the search input has only a `placeholder`, no `<label>` or `aria-label`.
- `pages/health/SettingsTab.tsx:33` — the `Switch` has no accessible name.
- 114 `placeholder=` attributes vs 107 `htmlFor` across 125 input elements — a meaningful share of inputs rely on placeholder text as their only label.

### M28 — Focus indicators removed

`MyFeedsPage.tsx:225` — `className="… outline-none focus:border-primary"`. `outline-none` strips the focus ring and the replacement is a 1 px border-colour change at ~2:1 contrast. WCAG 2.4.7 failure on the page's primary control. The `index.css:246` comment confirms a global focus-state block was deliberately removed.

### M29 — Status conveyed by colour alone

- `FeedHealthTab.tsx:6-10, 64-66` — health is a bare coloured dot (green/yellow/red) with no adjacent text and no `aria-label`. Fails WCAG 1.4.1 for colourblind users and is invisible to screen readers.
- `OverviewTab.tsx:98-106` — the stacked bar chart has `name` props on its `<Bar>`s but **no `<Legend>`**. Success vs error is distinguishable only by hovering. All four charts lack any text alternative (`role="img"` + `aria-label`, or an adjacent data table).
- `FeedTypeBadge` at its default `showLabel={false}` (used in `FeedTable.tsx:61` and `FeedDetailDrawer.tsx:70`) has no accessible name and its `<svg>` is not `aria-hidden` — the feed's type is simply absent for screen-reader users in the table.

### M30 — Heading structure

Only one `<h1>` per page, and it is inconsistently placed:
- `MyFeedsPage.tsx:257` — the `<h1>` sits *below* the search header and the stat tiles.
- `BuildFeedPage` — **no `<h1>` at all** in its default type-picker state; the header block is gated on `activeType` (`:131`).
- `SettingsPage` (h1) → `SettingsSection.tsx:27` (h3) and `SettingsTab.tsx:122` (h3) — **h2 is skipped**.
- No skip-link, no landmark labelling (`<aside>` and `<nav>` carry no `aria-label`), no per-route `document.title` (`index.html:6` is a static `<title>Feed Builder</title>` for all six routes — and it is off-brand; the product is Mkfd).

### M31 — Motion

Four custom keyframe animations (`index.css:178-244`), `tailwindcss-animate`, `animate-pulse`, `animate-spin`, a 0.2 s sidebar width transition (`Sidebar.tsx:42`) and an injected `slideInRight` (`FeedDetailDrawer.tsx:66`) — with **no `prefers-reduced-motion` media query anywhere** in the codebase.

---

## 7. Design system and visual consistency

### M32 — Three token systems that do not agree

1. **shadcn HSL triples** — `--background`, `--foreground`, `--primary` … (`index.css:6-75`), consumed via Tailwind.
2. **Workbench hex tokens** — `--wb-surface`, `--wb-ink`, `--wb-outline`, `--wb-primary` … (`index.css:33-47`), consumed via inline `style`.
3. **Feeds token aliases** — `--bg`, `--ink`, `--brand`, `--ok`, `--err` … (`styles/feeds-tokens.css`).

They are used interchangeably, sometimes **in the same style object** — e.g. `settings/SettingRow.tsx:33-35` mixes `hsl(var(--primary) / 0.12)`, `var(--wb-warning)` and `color-mix()` across three branches of one ternary. `TypePickerGrid.tsx:169-176` mixes `var(--wb-outline)`, `hsl(var(--border))`, `var(--wb-card)` and `hsl(var(--muted) / 0.4)` in one style object.

On top of that: **120 hard-coded hex colours** across 14 files. Commit `32d690d` ("replace remaining hardcoded badge hex colors with CSS variables") did not reach `FeedStatusBadge.tsx` or `FeedTypeBadge.tsx`, which remain 100 % hard-coded.

**M32a — the feeds token scale is decorative.** `feeds-tokens.css:5-12`:

```css
--ink:    hsl(var(--foreground));
--ink-2:  hsl(var(--foreground));   /* identical to --ink */
--ink-3:  hsl(var(--muted-foreground));
--ink-4:  hsl(var(--muted-foreground));   /* identical to --ink-3 */
--line:        hsl(var(--border));
--line-strong: hsl(var(--border));   /* identical to --line */
--brand:     hsl(var(--primary));
--brand-ink: hsl(var(--primary));    /* identical to --brand */
```

A four-step ink ramp with two distinct values, and three more token pairs that are aliases of each other. The scale looks complete and encodes nothing.

**M32b — global tokens are imported from a leaf page.** `feeds-tokens.css` is imported exactly once, from `pages/MyFeedsPage.tsx:3`. But its tokens are consumed elsewhere: `--shadow-pop` in `toast-provider.tsx:24` and `FeedActionsMenu.tsx:73`, `--feeds-font-mono` in `FeedTable.tsx:64` and `FeedDetailDrawer.tsx:26`. Two of those sites already carry defensive fallbacks (`var(--shadow-pop, 0 8px 32px …)`), which is the codebase acknowledging the fragility. Move the import to `index.css`.

### M33 — Dark mode is defined, wired into components, and can never activate

`tailwind.config.js:3` sets `darkMode: ["class"]`. `index.css:50-75` defines 25 dark tokens. Components use `dark:` variants (`loading-spinner.tsx:21, 31`). **Nothing anywhere adds the `dark` class** — no toggle, no `prefers-color-scheme` listener, no persisted preference. A repo-wide grep for `classList`, `'dark'`, `prefers-color-scheme` and `theme` returns exactly one hit, and it is an unrelated `"themeColor": "0076D7"` string in a webhook payload template.

Worse, if the class were ever set the result would be broken: the **entire `--wb-*` system has no dark variant**, so light workbench surfaces (`#ffffff` cards, `#f8f9fa` page background) would render behind the dark `--foreground` (`210 40% 98%`, near-white). Every `#fff` hard-coded on a button and `bg-white` knob would compound it.

Decide: ship dark mode properly (add `--wb-*` dark values and a toggle) or delete the `.dark` block, `darkMode: ["class"]` and all `dark:` variants.

### M34 — The redesign's typography never loads

`index.css:84` sets `font-family: "Geist", …` on `body`; `.workbench-label`, `.workbench-table th` and `.workbench-chip` set `"JetBrains Mono"`. Neither font is loaded anywhere — no `@font-face`, no `<link>` in `index.html`, no npm font package in `frontend/package.json`. Both silently fall back to the generic system stack, so the entire typographic identity of the Muted Iris redesign is absent in the running app. One `<link>` to Google Fonts (or two `@font-face` blocks with self-hosted woff2) fixes it.

### M35 — Custom animation utilities collide with `tailwindcss-animate`

`index.css:178-184` defines `.animate-in` and `.fade-in` in `@layer utilities`. `tailwindcss-animate` (a registered plugin, `tailwind.config.js:73`) defines `.animate-in` and `.fade-in-0` as its enter-animation primitives. Radix components rely on the plugin's version:

```
ui/dialog.tsx:39   data-[state=open]:animate-in … zoom-in-95 slide-in-from-top-[48%]
ui/tooltip.tsx:20  animate-in fade-in-0 zoom-in-95 …
ui/select.tsx:76   data-[state=open]:animate-in … zoom-in-95 …
```

The custom `.animate-in { animation: animateIn 0.3s ease-out }` (a 10 px translateY) overrides the plugin's animation property, so the plugin's `--tw-enter-opacity` / `--tw-enter-scale` variables are ignored and dialogs, tooltips and selects animate with the wrong motion. Rename the custom utilities.

### M36 — Miscellaneous visual

- `ui/loading-spinner.tsx:13` — the spinner is `border-orange-200 / border-t-orange-600`, off-brand for a slate/iris palette, alongside `bg-white dark:bg-slate-900` and `text-slate-700` (`:21, :31`) — raw Tailwind palette in a token-based system. Default message is the generic `"Processing your request..."` (`:7`).
- `MyFeedsPage.tsx:363-379` — the empty state renders a **literal blank 48 px grey square** where an illustration or icon was intended, and offers no CTA (the copy says "Create your first feed to get started" but there is no button).
- `FeedDetailDrawer.tsx:66` — a `<style>` element containing `@keyframes slideInRight` is injected into the component tree and re-mounted on every drawer open.
- Z-index is ad hoc across five unrelated scales: `50` (BottomNav, dialog, tooltip, select), `100` (toasts), `300`/`301` (drawer scrim/panel), `9999` (actions menu). The actions menu therefore renders above the drawer's modal scrim.
- Text glyphs used as icons where lucide equivalents are already imported elsewhere: `⋯` (`FeedActionsMenu.tsx:66`), `★`/`☆` (`FeedTable.tsx:54`), `×` (`toast-provider.tsx:30`, `FeedDetailDrawer.tsx:87`), `‹`/`›` (`ScrollableFilterRow.tsx:54, 77`), `↗` (`FeedDetailDrawer.tsx:41`).
- `TypePickerGrid.tsx:158` — `aria-label={type.label}` on the card `<button>` **overrides** its inner content, so the description ("Extract RSS from any webpage") is never announced. Remove the redundant `aria-label`.
- `TypePickerGrid.tsx:178-183` — hover shadow applied by mutating inline style in JS; no `:focus-visible` equivalent, so keyboard users get no hover affordance.
- `TypePickerGrid.tsx:198` — icon tile background is `rgba(255,255,255,0.6)`, hard-coded white.
- `Sidebar.tsx:186` uses `px-8` while its sibling nav items use `px-4` (`:146`) — the Collapse row is misaligned with the nav.
- `Sidebar.tsx:13` reads `localStorage` in a `useState` initialiser with no `try/catch`; throws in privacy modes and sandboxed contexts.
- `AppShell.tsx:11` uses `h-screen` (100vh), which mis-sizes on mobile browsers with a dynamic URL bar. Use `100dvh`.

---

## 8. Performance and build

- **944 KB single JS chunk.** `vite.config.ts:19-24` forces `entryFileNames: "assets/index.js"` and `manualChunks: undefined`, explicitly disabling Rollup's automatic chunking. `recharts` (~400 KB) is loaded on every route including the builder, which never charts anything. Zero `React.lazy`/`Suspense`. Splitting the health dashboard alone would roughly halve first load.
- `MyFeedsPage.tsx:62-83` recomputes `allTags`, `allTypes`, `filtered`, and three status counters on **every render** with no `useMemo` — amplified by the toast-driven re-render loop in H7.
- Nine files total use `useMemo`/`useCallback`; the two hottest components (`FeedBuilderForm`, `MyFeedsPage`) are not among the well-memoised ones. `useSourceAssistant.ts` memoises a cheap boolean (`isStale`, `:13`) while leaving all four returned functions unstable.
- N+1 sparkline fetches (M17).
- `FeedBuilderForm.tsx:59-123` rebuilds a 65-line `defaultValues` literal on every render. Harmless to RHF (read once) but it belongs at module scope.

---

## 9. Back end and security

### C1 — Sandbox escape in the selector playground **[PRE-EXISTING]**

`frontend/src/components/forms/SelectorPlayground.tsx:137`:

```tsx
sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
```

`allow-same-origin` combined with `allow-scripts` **removes the sandbox entirely** — MDN documents this exact pairing as allowing the framed content to remove its own sandbox attribute. The iframe's `src` is `/proxy?url=<user-supplied>` (`:27`), and `routes/utils.ts:178-180` returns the *remote site's HTML* from mkfd's own origin via `ctx.html(html)`.

Result: arbitrary third-party JavaScript executes with full same-origin privileges against the mkfd application. It can call `GET /api/feeds`, read every feed config (including `env:`-referenced secret names and encrypted blobs) via `/api/feeds/:id/config`, `DELETE /api/feeds/:id`, and read/write `/api/settings` — all with the user's session cookie automatically attached. `httpOnly` protects the cookie value from being read but does nothing to stop same-origin requests.

Fixes, in order of preference: (a) serve `/proxy` responses from a separate origin or a `blob:`/`srcdoc` context and drop `allow-same-origin`; (b) send `Content-Security-Policy: sandbox` and `script-src 'none'` on the `/proxy` response and strip `<script>` from the proxied HTML server-side; (c) at minimum, remove `allow-same-origin` and re-implement the SelectorGadget bridge over `postMessage`.

This is inherited from `main`, not introduced here — but this branch expands the surface (the Source Assistant adds more paths into `/proxy`-adjacent analysis) and it is the single most serious issue in the repo.

### C2 — Auth middleware fails open and trusts proxied traffic **[PRE-EXISTING]**

`index.ts:146-152`:

```ts
const connInfo = await getConnInfo(c);
const isLocal =
  !connInfo?.remote?.address ||
  ["127.0.0.1", "::1"].includes(connInfo.remote.address);
if (isLocal) return await next();
```

Two problems:

1. **Fail-open.** If `getConnInfo` cannot determine a remote address, `isLocal` is `true` and authentication is skipped entirely.
2. **Reverse-proxy blindness.** Behind nginx, Traefik, Caddy or Docker's default bridge networking — and this repo ships a `docker-compose.yml` — the socket peer address *is* `127.0.0.1` (or a gateway IP). Every request from the public internet therefore authenticates as local, and the entire application, including `/api/settings` and every feed config, is unauthenticated.

Fix: gate the local-bypass behind an explicit opt-in flag (`--trust-local` / `MKFD_TRUST_LOCAL=1`), default it off, and never treat an indeterminate address as local. If proxy deployment is supported, parse a configured trusted-proxy list plus `X-Forwarded-For` rather than the socket peer.

Related, same file:
- `index.ts:163` — `inputKey === passkey` is a timing-unsafe comparison of an auth secret. Use `crypto.timingSafeEqual` over fixed-length digests.
- No rate limiting or lockout on `POST /passkey` — unlimited brute force.
- No security headers anywhere: no CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- `index.ts:180` — `app.use("/configs/*", serveStatic({ root: "./" }))` serves the raw feed-config directory over HTTP. Behind the auth middleware, but C2 makes that a weak guarantee.
- `index.ts:213-215` — SIGINT/SIGTERM call `process.exit()` with no drain of in-flight feed runs; a worker killed mid-write can leave a truncated config or feed XML.
- `index.ts:194-205` — ten routers all mounted at `"/"`, making route precedence implicit. `POST /` (feed creation, `routes/feeds.ts:104`) shares a path with the SPA root.
- `index.ts:200` — port `5000` is hard-coded while every other runtime parameter is configurable.

**Worth noting as a strength:** the outbound fetch policy is done properly. `routes/utils.ts:125-129` calls `assertOutboundFetchAllowed` *before* fetching, re-checks the FlareSolverr endpoint separately (`:135-140`), and uses `axiosGetWithPolicyRedirects` (`:174`) so redirects are re-validated rather than followed blindly — which is the part most SSRF guards get wrong. `assertSafeFeedId` (`utilities/config-manager.utility.ts:63`) is a strict `/^[A-Za-z0-9_-]+$/` allowlist. Both are good work.

### H13 — Draft autosave writes secrets to localStorage

`hooks/useFeedDraft.ts:12-25` redacts by **denylist**:

```ts
const { emailPassword, emailUsername, headers, cookies, webhook,
        apiBody, apiHeaders, apiParams, ...safeData } = data;
```

Not redacted, and present in `types/feed.ts`:

| Field | Line |
|---|---|
| `webhookToken` | `types/feed.ts:316` |
| `webhookTokenHash` | `types/feed.ts:317` |
| `serviceConnectorApiKey` | `types/feed.ts:343` |
| `formFields` (KeyValuePair[] — POST form-scraping credentials) | `types/feed.ts:72` |

The intent is clearly correct; the list is just incomplete, and it will drift further every time a feed type is added. **Invert to an allowlist** of fields safe to persist.

Also: `sourceAssistantAnalysis` (M4) is not redacted either, so the full page observation — potentially including fetched HTML — is written to localStorage.

### M37 — Committed credentials

Two files ship the same weak secrets:

```
package.json:9   "dev": "bun --watch index.ts --passkey=admin123
                  --cookieSecret=a18c1fd2211edd76a18c1fd2211edd76
                  --encryptionKey=a18c1fd2211edd76"
frontend/playwright.config.ts:31   PASSKEY=admin123 COOKIE_SECRET=a18c1fd2211edd76a18c1fd2211edd76
                                   ENCRYPTION_KEY=a18c1fd2211edd76 bun index.ts
```

The cookie secret is the encryption key repeated twice. These are development values, but committed real-looking secrets get copied into deployments. Move to a git-ignored `.env.local` and have both scripts read from it.

### M38 — Dependency hygiene

`package.json` lists `bun` (the runtime) and `readline` (a Node builtin; the npm package is a deprecated stub) as runtime dependencies; `bun-types` in `dependencies` duplicates `@types/bun` in `devDependencies`; `@types/xml` is present with no `xml` package; `xmldom@^0.6.0` is the deprecated pre-scoped package (superseded by `@xmldom/xmldom`) and carries known advisories. `frontend/package.json` ships `zod` and `@hookform/resolvers` with zero imports.

### L3 — Back-end code quality

227 `any` usages, 118 raw `console.*` calls with no structured logger and no log levels, 74 decorative `// ---` banner comments. `index.ts:90-112` catches DB init failure, logs, then proceeds to call `getDb()` in the next block guarded by a second catch that logs "continuing with file-based fallback" — the process starts silently degraded with no health signal or readiness probe.

---

## 10. Testing

- **5 e2e specs, ~137 lines, for +90,421 lines of change.** Two tests touch feeds at all.
- `playwright.config.ts:16-21` — a single `chromium` / `Desktop Chrome` project. All responsive behaviour is untested, which is exactly why H12 (Health/Settings unreachable below `lg`) went unnoticed.
- No accessibility assertions and no `axe` integration, in a branch that rebuilt every screen.
- `playwright.config.ts:31` uses POSIX inline env-var syntax (`PASSKEY=admin123 bun index.ts`), which **fails on Windows** — the platform this repo is being developed on. Use `cross-env` or Playwright's `env` option.
- `e2e/basic.spec.ts:4` asserts `toHaveTitle(/Feed Builder/i)`, locking in the off-brand static title (M30).
- Back-end unit coverage is genuinely good by contrast — 33 new test files under `tests/`, including substantial suites for `outbound-fetch-policy` (425 lines), `app-settings` (426), and `protected-values` (193). The gap is entirely on the front end.

---

## 11. Recommended order of work

**Before merge**

1. C1 — remove `allow-same-origin` from the proxy iframe, or isolate `/proxy` to a separate origin.
2. C2 — make the local-auth bypass explicit opt-in; never fail open.
3. H1 — real soft-delete/restore, or a confirmation dialog; remove the fake undo.
4. H5 — one-line fix: `calendar: "calendar"` in `APPLY_TYPE_MAP`.
5. H6 — verify and fix the actions-menu outside-click handler (this may mean the menu is entirely non-functional today).
6. H8 — thread `isSubmitting` to the header button.
7. H13 — invert draft redaction to an allowlist.
8. H2 — replace simulated progress with a real signal or an honest spinner.

**First follow-up**

9. H7 — memoise the toast context value.
10. H14 — add an error boundary at the `AppShell` level plus a `*` route.
11. H12 — add Health and Settings to `BottomNav`, or a mobile drawer.
12. H10 — darken `--muted-foreground` and `--wb-outline`; fix the six other failing pairs.
13. H9 — rebuild `FeedDetailDrawer` on `@radix-ui/react-dialog`.
14. H11 — route all 13 `alert()` calls through `useToast()`, and add `role="status"` + `aria-live` to the toast container.
15. H3/H4 — delete the nine alias adapter files; fix the starter-config fallback so non-scrape routes produce a usable builder.

**Consolidation pass**

16. M1 — single `FEED_TYPES` registry (id, label, description, icon from lucide, tokenised colours) consumed by all seven current call sites; reconcile the builder and summary type vocabularies.
17. M32/M33/M34 — pick one token system, add `--wb-*` dark values or delete dark mode, load the two fonts.
18. M25/M26/M27 — `aria-pressed`/`aria-current` on all toggles, keyboard access for `<td>`/`<Card>` click targets, make `Field`'s `htmlFor` required.
19. M7 — delete the dead code and dependencies listed in the table.
20. Add a mobile Playwright project and `axe` assertions; extend e2e past the two current feed tests.

---

## 12. Overall assessment

The branch is a large, ambitious, and in places genuinely well-engineered piece of work. The back-end decomposition into `routes/` and `utilities/` is a real improvement over the 1,900-line `index.ts` it replaces; the outbound-fetch policy and feed-id validation are done carefully; and 33 new back-end test files is a serious investment.

The front end is where it comes apart, and the pattern is consistent: **structure that signals completeness without delivering it.** A directory of nine adapter files that are alias re-exports. A twelve-step progress checklist driven by a timer. A four-level ink ramp with two values. A confidence meter fed by hard-coded decimals. A dark theme with no toggle. A typographic system whose fonts never load. An `active` flag that is always true, guarding twenty lines of unreachable UI. Seven copies of the same label map, one of which shows users the string `serviceConnector`.

These are not separate mistakes; they are one habit. The remedy is the same in each case: delete the scaffolding, keep the single real implementation, and make the thing the UI claims to be doing actually be the thing it is doing. Roughly a third of the front-end findings here resolve by deletion alone.

The accessibility position needs stating plainly: 34 ARIA attributes and 2 roles across 11,440 lines, no `aria-live`, no focus management on the one modal surface, keyboard-unreachable primary affordances, and the default secondary text colour below AA. For a self-hosted tool this may be an accepted trade-off — but it should be an accepted trade-off rather than an unnoticed one, and the `--muted-foreground` and focus-ring fixes are cheap enough that there is no reason not to take them.
