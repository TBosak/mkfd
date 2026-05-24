
Concise corrections + release roadmap layered on top of the detailed `Mkfd_Enhancements_Overview.md`
and grounded against `TBosak/mkfd` `main`. Canonical visual: `Mkfd_Dependency_Tiers.svg`.
This doc holds the decisions and ordering; the Overview holds the per-plan implementation detail.

**Latest fold-in:** Existing Feed Transformer plan + adjusted tiers (Existing Feed Transformer
promoted out of "deferred"; Normalized Feed Item Pipeline added to Tier 1).

---

## 1. What already exists in `main` (extend, don't rebuild)

| Capability | Where in repo | Effect on the plan |
|---|---|---|
| Encryption (encrypt/decrypt) | `utilities/security.utility.ts` (`node-forge`), `ENCRYPTION_KEY` | Encryption plan **generalizes** this into `ProtectedValue`; not greenfield |
| Drill chain + CSS extraction | `models/csstarget.model.ts`, `utilities/data-handler.utility.ts` | Drill chain is **done**; only JSON-LD extraction mode is missing |
| Selector suggestion engine | `utilities/suggestion-engine.utility.ts` | Source Assistant **reuses** it for CSS suggestions |
| Feed object → RSS | `utilities/rss-builder.utility.ts` builds `new Feed()` + `.rss2()` (`feed@5.1.0`) | Feed Format = add `.atom1()`/`.json1()` + two writes; near-trivial |
| User-agent handling | `utilities/user-agents.utility.ts` | Proxy/UA plan **extends** this; adds proxy + per-feed profiles |
| Outgoing webhook | `utilities/webhook.utility.ts` | Inbound webhook feed is the new part |
| File-based change state | `utilities/feed-history.utility.ts` → `./feed-history/${feedId}.xml` | Migrates onto SQLite (see §3); keep its API as a `FeedHistoryStore` interface |
| Feed/XML parsing | `xmldom` (already a dep) | Existing Feed Transformer parses RSS/Atom/JSON Feed with it — **no new parser dep for MVP** |
| Advanced scraping | `patchright@1.51.3` (stealth Playwright) | FlareSolverr fallback is still TODO (greenfield) |
| React + shadcn frontend | `frontend/` (Vite, `components.json`, Tailwind) | Active Feeds redesign is component work, not a migration |
| Worker dispatch | `workers/feed-updater.worker.ts` branches `webScraping`/`api`; email separate | Type-switch dispatch already exists; new types slot in |

Current source types: web scraping, REST API, email (email runs in a separate Node process).

**New shared architecture (from the Existing Feed Transformer plan):** every source resolves to
`source data → NormalizedFeedItem[] → Feed object → RSS/Atom/JSON`. The transformer is the first
consumer that proves this pipeline; future source types return `NormalizedFeedItem[]` too.

---

## 2. Corrections (status)

### 2.1 Output filenames use `feedId`, not `feedName` — keep it that way ✅ adopted
`main` serves `/public/feeds/${feedId}.xml`. All three formats are `${feedId}.xml/.atom/.json`.
`feedName` is display metadata only. The new plan and Overview both lock this.

### 2.2 Config schema gap is narrow — add request/extraction modes only ✅ adopted
Drill chain + CSS exist. Add discriminators before `schemaVersion: 2` ships:
`request.mode: "simple" | "form"` (simple exists) and
`extraction.mode: "css" | "jsonLd" | "jsonLdWithCssFallback" | "manual"` (css exists). Legacy
`article.*` selectors map to `extraction.mode = "css"`.

### 2.3 One `ProtectedValue`, owned by Encryption ✅ adopted
`models/protected-value.model.ts` (with `prefix`/`suffix` + `ConfigValue`) wraps the existing
`security.utility`; Config Formalization imports it.

### 2.4 Source Assistant = spine + per-route plugins — apply target now exists ✅ resolved
Build the engine + web route reusing `suggestion-engine.utility.ts`. **The existing-feed route's
apply target is the Existing Feed Transformer, now in the same tier** — so ship them together in
the scraping-intelligence release and the "Create cleaned Mkfd feed" action works end-to-end.
(Earlier "detect-and-recommend only" caveat no longer applies.)

### 2.5 Feed Format refactor before GraphQL's shared builder ✅ adopted
Formalize "build one `Feed`, serialize three ways" first (the `buildFeedFromNormalizedItems` +
`writeAllFeedFormats(feedId, feed)` shape), then extract the structured-data builder shared by
`api` and `graphql`.

### 2.6 Split the Tweaks note ✅ adopted
Footer fix ships immediately. Run-log un-filter fix lands with the Feed Health branch (Tier 0/1).

### 2.7 Minimal inline validation stub ✅ adopted
Required-block-per-`feedType` at save + catalog submission guard. Existing Feed Transformer adds
its own checks (valid `sourceUrl`, `sourceFormat`, regex filters compile, GUID/date strategy
supported; SSRF/private-IP warning).

---

## 3. SQLite substrate — refine, don't re-plan

The SQLite branch is the runtime-state foundation. Keep it small and strict.

- **YAML stays the source of truth.** Configs remain `/app/configs/${feedId}.yaml`. SQLite stores
  only *runtime state*, never feed definitions.
- **Migrate `feed-history` onto it.** Wrap the existing `getPreviousFeedHistory` /
  `storeFeedHistory` / `clearFeedHistory` API behind a `FeedHistoryStore` interface; on read, fall
  back to `./feed-history/${feedId}.xml` during migration so nothing breaks.
- **Tables now:** `feed_runs`, `feed_history_snapshots`, `feed_history_items`.
- **Reserve (don't build yet):** `webhook_events`, `fs_scan_state`, `sitemap_state`,
  `connector_cursors`, `analysis_cache` — so Tier 4/5 source types extend storage instead of each
  inventing their own.
- **Feed Health & Run History already rides this branch** — proof the substrate works. Confirm the
  schema is general, then merge.

---

## 4. Dependency flow (matches `Mkfd_Dependency_Tiers.svg`)

Each tier depends on the tiers above it. Items already in `main` are extended, not rebuilt.

```
TIER 0 — Foundation
  Optional Config Value Encryption   ── generalizes security.utility; owns ProtectedValue
  Feed Configuration Formalization   ── new models over csstarget/api-mapping; add request/extraction modes
  SQLite Runtime Substrate           ── feed_runs / feed_history_snapshots / feed_history_items
  Feed History Migration             ── FeedHistoryStore wraps existing API; read-through fallback
  Minimal Inline Validation
  Footer + run-log filter fixes

TIER 1 — Output & operations
  Feed Format Refactor               ── extend existing Feed object; ${feedId} filenames
  Normalized Feed Item Pipeline      ── shared NormalizedFeedItem[] adopted by all source types
  Feed Config Management GUI [kept]  ── React/shadcn over /app/configs
  My Feeds / Active Feeds Redesign   ── React component work; wire to Feed Health

TIER 2 — Transformation & scraping intelligence
  Existing Feed Transformer          ── consumes NormalizedFeedItem[]; reuses writeAllFeedFormats + xmldom
  Basic cleanup / field transforms   ── ships INSIDE the transformer (not the full engine)
  Source Assistant spine + web route ── reuses suggestion-engine + drill chain
  Existing-feed apply target         ── transformer is the apply target for detected feeds
  JSON-LD Integration                ── new extraction mode beside CSS/drill
  Web Scraping Form Data             ── request.mode = form
  Fetch Policy / Retry / Fallback [kept]  ── retry/timeout + FlareSolverr (greenfield)
  Proxy / User-Agent Profiles [kept]      ── extends user-agents.utility

TIER 3 — Catalog & import
  Parameterized Feed Templates
  Community Catalog                  ── encryption sanitizer + inline catalog guard
  Catalog Import / Export Flow
  Service Connector Request Template ── independent, ship anytime

TIER 4 — New source types (each ships its own Source Assistant route; returns NormalizedFeedItem[])
  Sitemap     ── JSON-LD detail extraction + sitemap_state
  Calendar    ── new dep ical.js
  GraphQL     ── after Feed Format refactor; shares structured-data builder with api
  Webhook     ── inbound endpoint + webhook_events
  Filesystem  ── glob dep + fs_scan_state + safe-root

TIER 5 — Service connectors
  Connector registry + auth + connector_cursors + presets
  Jellyfin reference connector first; catalog submission stays blocked for serviceConnector
```

**Still deferred:** full universal field-transform engine, advanced/computed field expressions,
full Change Detection feed type, feed merging/splitting, and linked-page enrichment. (Basic cleanup
and include/exclude filtering arrive early, inside the Existing Feed Transformer.)

---

## 5. Release roadmap (6 releases)

**R1 — Foundation (Tier 0).** Encryption `ProtectedValue` over `security.utility` + header/cookie
storage. Config Formalization models with request/extraction discriminators; `schemaVersion: 2`;
inline validation. SQLite substrate + feed-history migration (FeedHistoryStore). Footer + run-log
fixes.

**R2 — Output & operations (Tier 1).** Feed Format (`.atom`/`.json`, `${feedId}`). Normalized Feed
Item Pipeline. Feed Config Management GUI. My Feeds / Active Feeds redesign wired to Feed Health.

**R3 — Transformation & scraping intelligence (Tier 2).** Existing Feed Transformer (basic cleanup +
filters) **with** the Source Assistant spine + web route + existing-feed apply target. JSON-LD. Web
Scraping Form Data. Fetch/Retry/Fallback (+ FlareSolverr). Proxy/UA profiles.

**R4 — Catalog & import (Tier 3).** Parameterized Templates. Community Catalog + import/export flow.
Service Connector issue template.

**R5 — New source types (Tier 4).** Sitemap (+ route), Calendar (+ route), GraphQL (after Feed
Format refactor), Webhook, Filesystem — each extending the reserved SQLite tables and returning
`NormalizedFeedItem[]`.

**R6 — Service connectors (Tier 5).** Registry + auth + cursor model + presets; Jellyfin reference,
then others.

---

## 6. The one rule

> Lock the canonical config schema (request/extraction discriminators + a single `ProtectedValue`
> over the existing encryption utility) and the `NormalizedFeedItem` pipeline in R1–R2, on top of the
> SQLite substrate's runtime-state tables. Keep `${feedId}` output filenames and YAML configs.
> Everything downstream resolves against that schema and that item shape, so getting them right once
> avoids re-migrations across R3–R6.

New runtime deps to expect: `ical.js` (calendar), a glob library (filesystem), and possibly a
dedicated feed parser later (behind `parseExistingFeed`, only if `xmldom` proves brittle).
Everything else is already present.

---

## 7. Document map (keep these in sync)

- `Mkfd_Enhancements_Overview.md` — detailed implementation master (per-tier specifics, table DDL,
  checklists). Source of truth for *how*.
- `Mkfd_Release_Review_and_Plan.md` (this doc) — decisions, corrections, and release ordering.
  Source of truth for *what/when*.
- `Mkfd_Dependency_Tiers.svg` — canonical tier diagram. Source of truth for *the picture*.
- Per-feature plans (e.g. `Existing_Feed_Transformer_Implementation_Plan.md`) — the spec for one
  feature; must conform to the schema/pipeline/filename rules above.
