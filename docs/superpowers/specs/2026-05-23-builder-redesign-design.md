# Builder UI Redesign — Design Spec

**Date:** 2026-05-23
**Tier:** R2 Output & Operations
**Status:** Approved
**Design source:** Claude Design prototype (U7So5wVyAkB07gi8DUiwjg / `docs/features/Mkfd UI Redesign/`)

---

## Goal

Replace the flat, tab-based `FeedBuilderForm` with a multi-phase, section-based builder that mirrors the design prototype: a type-picker landing, a collapsible section navigator, an always-visible preview panel, and a sticky save bar. **No existing functionality is removed** — all current form fields are preserved, remapped into the new section structure.

---

## Scope

### In scope

**Layout & shell changes**
- New 3-column builder layout for desktop: `section-nav | build-main | build-side`
- Collapsible `SectionNav` left rail (icon + label + optional count per section)
- `SectionPager` prev/next bar at bottom of `build-main`
- `PreviewPanel` right column — always visible on desktop (≥1024px), drawer-toggle on mobile
- `SectionHeader` title bar at top of each section body
- Sticky save bar at the bottom of `build-main` (duplicates header save + "Test feed" button)
- Page header: back arrow, title breadcrumb, autosave dot indicator, Discard + Save buttons
- Feed type picker landing (replaces current tab interface)

**Phase flow (builder phases)**
- `ASSISTANT` — landing: URL input (non-functional stub; wired to "skip to picker" UX) + type card grid
- `BUILDER` — fully functional multi-section form (the core of this redesign)
- `ANALYZING` and `RECOMMEND` — visual stubs only (no backend analysis; wired to Source Assistant in Phase 3)

**Builder section restructure per feed type**

| Type | Sections |
|---|---|
| webScraping | Basic · Source · Headers & Cookies · Extraction · Output · Advanced |
| api / rest | Basic · Endpoint · Response Mapping · Headers · Output |
| email | Basic · Connection · Filter |

All other types (graphql, calendar, sitemap, filesystem, webhook, feedTransformer, serviceConnector) show a "Coming soon" placeholder section.

**Functionality preserved from existing `FeedBuilderForm`**
- `react-hook-form` remains the form state manager
- All webScraping fields: feedUrl, selector, itemSelector, titleSelector, authorSelector, dateSelector, enclosureSelector, enclosureType, strict, reverse, advanced, titleStripHtml, authorStripHtml, summaryStripHtml
- All api fields: feedUrl, jsonPath, titlePath, linkPath, datePath, descriptionPath, authorPath, enclosurePath, method, headers
- All email fields: imapHost, imapPort, imapUser, imapPassword, imapFolder, emailCount
- `AdditionalOptions`: feedName, feedDescription, tags, category, refreshTime, webhook.enabled, webhook.url, webhook.newItemsOnly
- FlareSolverr indicator
- `DraftRestoreDialog` + `useFeedDraft` auto-save
- Create mode (`POST /`) and edit mode (`PUT /api/feeds/:id`)
- `FeedPreview` (moved to `PreviewPanel` right column)

**New shared primitives** (added alongside form restructure)
- `Section` — collapsible card with icon, title, sub, right slot
- `Field` / `FieldRow` — form field layout wrapper (2- and 3-column grid rows)
- `KVEditor` — key-value editor with Plain / Encrypt / Env per-row storage toggle (for headers, cookies)
- `StorageSelect` — Plain / Encrypt / Env dropdown used by KVEditor rows

### Out of scope

- Source Assistant URL analysis / recommendation (Phase 3 — `Source Assistant` feature)
- Selector Playground (interactive HTML preview with highlighting) — Phase 3
- JSON-LD / Drill Chain extraction modes — Phase 3
- Extraction mode card picker (shown as stub "CSS selectors only" for now)
- Mobile bottom nav (App Shell / Navigation Redesign feature)
- Collapsible aside global nav (App Shell / Navigation Redesign feature)

---

## Design System

Uses the same shadcn blue-gray token bridge as My Feeds (`feeds-tokens.css`). No additional CSS token file is needed — the builder imports the same file. The prototype's `var(--bg)`, `var(--ink)`, `var(--line)` etc. all resolve to the shadcn default palette via the alias layer.

Feed type icon backgrounds in the type picker use the same `TYPE_META` color map defined in `FeedTypeBadge`.

---

## Phase Structure

```
ASSISTANT (landing)
├── URL input (stubbed — shows "Source Assistant coming soon" tooltip)
├── Type card grid (10 types — 7 "coming soon", 3 active)
└── → onPickType(typeId) → BUILDER

ANALYZING (stub visual only)
└── "Source analysis is a Phase 3 feature" placeholder progress screen

RECOMMEND (stub visual only)
└── Returns to ASSISTANT on any interaction

BUILDER (fully functional)
├── SectionNav (left rail, collapsible)
├── build-main
│   ├── SectionHeader
│   ├── <ActiveSection content>
│   └── SectionPager (prev/next)
└── build-side
    └── PreviewPanel (live feed preview tabs: Items / RSS / Atom / JSON)
```

---

## New Components

All new layout/primitive components live in `frontend/src/components/builder/`. The form sections themselves are kept in `frontend/src/components/forms/` alongside existing sub-forms.

### `BuilderLayout.tsx`

Top-level layout for the builder page. Props: `sections`, `activeSection`, `onSectionChange`, `navCollapsed`, `onToggleNav`, `preview` (ReactNode), `children`.

Renders:
- `<SectionNav>` (if `sections.length > 1`)
- `<div className="build-main">`: `<SectionHeader>` + `{children}` + `<SectionPager>`
- `<aside className="build-side">`: `{preview}`

### `SectionNav.tsx`

Left-rail collapsible navigator. Props: `sections: BuilderSection[]`, `active: string`, `onChange`, `collapsed: boolean`, `onToggleCollapsed`.

`BuilderSection` type: `{ id: string; label: string; icon: string; count?: number }`.

Collapsed state shows only icons (48px wide). Expanded shows icons + labels (200px). Toggle button at top right of nav.

### `SectionHeader.tsx`

Section title bar. Props: `title`, `sub`, `ix`, `total`.

### `SectionPager.tsx`

Prev/Next bar at bottom of section. Props: `sections`, `active`, `onChange`.

### `Section.tsx`

Collapsible card wrapper (same pattern as `builder-shared.jsx`). Props: `icon`, `title`, `sub`, `right`, `collapsible`, `defaultOpen`, `children`.

### `Field.tsx` / `FieldRow.tsx`

Field layout wrapper. `Field` props: `label`, `hint`, `required`, `optional`, `span` (full-width). `FieldRow` props: `cols` (2 or 3).

### `KVEditor.tsx`

Rows of key-value inputs each with a `StorageSelect`. Props: `rows: KVRow[]`, `onChange`, `keyPlaceholder`, `valuePlaceholder`, `showStorage`, `addLabel`.

`KVRow` type: `{ key: string; value: string; storage: "plain" | "protected" | "env" }`.

Warns inline when a sensitive-named key (authorization, token, cookie, etc.) has `storage: "plain"`.

### `StorageSelect.tsx`

Three-option dropdown: Plain / Encrypt / Env. Props: `value`, `onChange`, `sensitive`.

### `TypePickerGrid.tsx`

10-card grid of feed types. Active types (webScraping, api, email) are clickable; others show a "Coming soon" badge. Uses `FeedTypeBadge` for the icon chip.

### `PreviewPanel.tsx`

Right-column preview. Props: `feedName`, `sourceUrl`, `feedType`. Shows mock items in 4 tabs: Items / RSS XML / Atom XML / JSON Feed. (Wires to the existing `FeedPreview` component logic.)

### `BuildFeedPage.tsx`

Top-level page component (replaces inline composition in current `FeedBuilderForm`). Manages:
- `phase: "assistant" | "builder"` state
- `activeType: string | null`
- `activeSection: string`
- `navCollapsed: boolean`
- `previewOpen: boolean` (mobile)
- Draft key computation + `useFeedDraft` + `DraftRestoreDialog`
- Submit to `POST /` (create) or `PUT /api/feeds/:id` (edit)

---

## Section Mapping — Web Scraping

**Section 1: Basic**  
Fields: Feed name, Category, Refresh interval (minutes), Tags, Feed description

**Section 2: Source**  
Fields: Feed URL (required), Request mode (Simple URL only for now — Form submission is Phase 3), FlareSolverr toggle

**Section 3: Headers & Cookies**  
KVEditor rows for headers (default: Authorization, Cookie rows, both empty). KVEditor rows for cookies.

**Section 4: Extraction**  
Stub: single ModeCard "CSS Selectors (per field)" shown as active. Iterator selector input, then per-field inputs: title, link, pubDate, description, author, enclosure (URL + type). Each has `span` (full-width).

**Section 5: Output**  
Fields: Reverse order toggle, Strict mode toggle, Strip HTML toggles (title/author/summary), Webhook enabled toggle → webhook URL + new items only toggle.

**Section 6: Advanced**  
Fields: Advanced mode toggle, user-agent select (stubbed), timeout (stubbed).

---

## Section Mapping — REST API

**Section 1: Basic** — same as web scraping  
**Section 2: Endpoint** — method (GET/POST), base URL, route  
**Section 3: Response Mapping** — items JSON path, title/link/date/description/author/enclosure path fields  
**Section 4: Headers** — KVEditor  
**Section 5: Output** — webhook, advanced

---

## Section Mapping — Email

**Section 1: Basic** — feed name, category, tags  
**Section 2: Connection** — IMAP host, port, user, password (StorageSelect default: protected), folder  
**Section 3: Filter** — email count, future filter options (stubbed)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/components/builder/BuilderLayout.tsx` | 3-column layout shell |
| Create | `frontend/src/components/builder/SectionNav.tsx` | Collapsible section navigator |
| Create | `frontend/src/components/builder/SectionHeader.tsx` | Section title bar |
| Create | `frontend/src/components/builder/SectionPager.tsx` | Prev/Next bar |
| Create | `frontend/src/components/builder/Section.tsx` | Collapsible card wrapper |
| Create | `frontend/src/components/builder/Field.tsx` | Field label + hint wrapper |
| Create | `frontend/src/components/builder/FieldRow.tsx` | 2/3-column field row |
| Create | `frontend/src/components/builder/KVEditor.tsx` | Protected key-value editor |
| Create | `frontend/src/components/builder/StorageSelect.tsx` | Plain/Encrypt/Env dropdown |
| Create | `frontend/src/components/builder/TypePickerGrid.tsx` | Feed type picker landing |
| Create | `frontend/src/components/builder/PreviewPanel.tsx` | Right-column live preview |
| Create | `frontend/src/pages/BuildFeedPage.tsx` | Top-level builder page (phase/section state) |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Decompose into section components; keep as form state/submit hub |
| Modify | `frontend/src/components/forms/WebScrapingForm.tsx` | Adapt to Section/Field/FieldRow; add KVEditor for headers/cookies |
| Modify | `frontend/src/components/forms/APIForm.tsx` | Adapt to Section/Field/FieldRow; add KVEditor for headers |
| Modify | `frontend/src/components/forms/EmailForm.tsx` | Adapt to Section/Field/FieldRow; StorageSelect on password |
| Modify | `frontend/src/App.tsx` | Route `/` and `/feeds/:id/edit` to `BuildFeedPage` |
| Modify | `frontend/src/components/layout/Header.tsx` | Update "Create Feed" nav link if needed |

---

## Dependencies

- **App Shell / Navigation Redesign** should be implemented before or alongside this feature — the page header back-button and nav behavior depend on the new navigation shell.
- **Auto-save Draft** must be implemented first — `useFeedDraft` + `DraftRestoreDialog` are wired into `BuildFeedPage`.
- **Protected Value Encryption** must be implemented first — `StorageSelect` uses `{ type: "protected" }` value shape.
- **Feed Config Formalization** must be implemented first — `FeedMetadata` fields (tags, category, description) are surfaced in the Basic section.

---

## Functionality Preservation Checklist

Agents implementing this must verify each item before marking the task complete:

```text
[ ] Feed name, description, tags, category, refreshTime fields present in Basic section
[ ] webScraping: feedUrl, selector, itemSelector, titleSelector, dateSelector, authorSelector, enclosureSelector, enclosureType fields all present
[ ] webScraping: strict, reverse, advanced, *StripHtml toggles all present
[ ] webScraping: FlareSolverr indicator still visible
[ ] api: baseUrl, method, route, jsonPath, title/link/date/description/author/enclosure paths all present
[ ] api: headers KVEditor present
[ ] email: imapHost, imapPort, imapUser, imapPassword (protected), imapFolder, emailCount fields present
[ ] webhook.enabled, webhook.url, webhook.newItemsOnly present in Output section
[ ] DraftRestoreDialog mounts and restores on return
[ ] Create mode submits to POST /
[ ] Edit mode submits to PUT /api/feeds/:id and navigates to /feeds
[ ] FeedPreview renders in right panel
[ ] TypeScript compiles cleanly (bun run tsc --noEmit in frontend/)
```

---

## Tests

### Frontend (manual smoke test)

```text
Build feed page loads at /
Type picker shows 10 cards; 3 active, 7 "coming soon"
Clicking "Web Scraping" enters section navigator view
SectionNav shows 6 sections; clicking each switches content
SectionPager prev/next navigates between sections
Preview panel visible on desktop
All webScraping fields accessible across sections
All api fields accessible across sections
All email fields accessible across sections
Submit creates feed (POST /) and navigates to /feeds
Edit mode loads initial data into form fields
Discard navigates back to /feeds
Draft saved indicator visible after typing
DraftRestoreDialog appears on return visit
Collapsed nav shows icons only; expanded shows labels
```
