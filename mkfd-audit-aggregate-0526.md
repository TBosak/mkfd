# Aggregated Audit — `major-revision-0526`

**Sources merged**
- `mkfd-audit-claude-0526.md` — Claude Opus 5, static analysis of the full diff (referred to below as **[C]**)
- `../mkfd-major-revision-0526-audit.md` — Codex, static analysis plus live verification: build, lint, `bun audit`, e2e run, 390 px device measurement (**[X]**)
- Security addendum, 2026-09-02 — Codex threat-model and data-flow review, current dependency audit, security-control reachability analysis, and verification against current OWASP, GitHub Advisory Database, and Docker guidance (**[S]**, §8)

The two audits were produced independently. This document reconciles them, records where each found something the other missed, and notes the cases where a claim was cross-verified and strengthened.

**Audited commit:** `c8a54df` · **Diff:** 355 files, +90,421 / −4,014 vs `origin/main`

**Security addendum status:** no application code was changed. Section 8 adds findings to this report and supersedes the final paragraph's characterization of the backend security posture where the two conflict.

---

## 1. How the two audits relate

They agree on the shape of the problem and overlap on roughly a quarter of the findings. The difference in coverage is structural, not evaluative:

| | **[C] Claude** | **[X] Codex** |
|---|---|---|
| Method | Exhaustive static read of all 11,440 FE lines + backend routes/utilities; computed WCAG ratios; cross-file constant tracing | Live verification — production build, `bun audit`, isolated Biome run, e2e execution, browser measurement at 390×844 |
| Unique strength | Logic and data-flow defects, design-system integrity, security review, colour maths | Everything requiring execution: CVEs, lint counts, real bundle numbers, actual mobile rendering |
| Findings raised | 2 Critical, 14 High, 38 Medium, 3 Low | 4 P0, 5 P1, 6 P2 |
| Overlap | 12 findings in common | |
| Unique to it | 34 | 7 |

Neither audit is a superset. **[X]** caught two release blockers **[C]** could not see without running the app (mobile builder collapse, dependency CVEs) and one governance failure **[C]** did not think to check (front-end lint excluded). **[C]** caught two Critical security issues, six functional bugs, and the entire design-system layer that **[X]** did not reach.

Where the audits report different numbers for the same metric, both are correct under different counting rules — noted inline.

---

## 2. Consolidated severity register

Ordering is by risk, not by source. `[C]` / `[X]` / `[C+X]` marks provenance.

### Critical — exploitable

| ID | Finding | Location | Src |
|---|---|---|---|
| **A1** | **Proxy iframe sandbox is defeated.** `sandbox="allow-same-origin allow-scripts …"` on an iframe whose `src` is `/proxy?url=<any site>`, which returns remote HTML from mkfd's own origin (`routes/utils.ts:178`). Arbitrary third-party JS gets full same-origin access: read every feed config, `DELETE /api/feeds/:id`, read/write `/api/settings`, all with the session cookie attached. | `SelectorPlayground.tsx:137` | **[C]** |
| **A2** | **Auth middleware fails open and trusts proxied traffic.** `!connInfo?.remote?.address \|\| ["127.0.0.1","::1"].includes(…)` → auth skipped when the address is indeterminate, and behind any reverse proxy or Docker bridge (this repo ships `docker-compose.yml`) every internet request presents as `127.0.0.1`. The whole app becomes unauthenticated. | `index.ts:146-152` | **[C]** |

Both are **pre-existing on `main`**, verified via `git show main:<path>` — not introduced by this branch. They are listed first because they are the highest-consequence issues in the repository and this branch materially expands the surface around A1.

### Release blockers — functional

| ID | Finding | Location | Src |
|---|---|---|---|
| **B1** | **Source Assistant routes recommendations to the wrong builder.** `APPLY_TYPE_MAP` maps `calendar → "email"`; `sitemap`, `graphql`, `serviceConnector`, `changeDetection` are unmapped and fall through to `?? "webScraping"`. Compounded server-side: the starter-config fallback emits `sourceUrl`, a field no form reads (forms use `feedUrl` / `calendarUrl` / `sitemapUrl` / `graphqlEndpoint`), and emits `feedType` values (`manual`, `changeDetection`) absent from the `FeedFormData` union. **6 of 10 route types are broken end-to-end.** | `BuildFeedPage.tsx:59-65, 116` + `starter-configs/index.ts:56-62` | **[C+X]** |
| **B2** | **The builder is unusable on mobile.** `BuilderLayout` is an unconditional side-by-side flex — no breakpoint anywhere. Preview is `min-w-[360px] shrink-0` at `width: 42%`; the form is `min-w-0` at 58%. **[X]** measured the form collapsing to ~49 px at 390×844. Code confirms: at 390 px the preview claims 360 px and the form gets what remains. | `BuilderLayout.tsx:16-33`, `BuildFeedPage.tsx:224` | **[X]**, code-confirmed by **[C]** |
| **B3** | **Delete "Undo" is fake.** DELETE fires immediately; the Undo action restores React state only (`// No backend undo — just restore UI state`). The row reappears, then vanishes on refresh. No confirmation dialog either — and there are **zero `confirm()` calls in the entire front end**. | `MyFeedsPage.tsx:177-203` | **[C+X]** |
| **B4** | **Vulnerable dependency set.** `bun audit`: **58 root vulnerabilities (1 critical, 18 high, 35 moderate, 4 low)**; front end **15 (8 high)**. Runtime-relevant: `xmldom@0.6.0` (abandoned; used to parse *untrusted fetched RSS/Atom* at `existing-feed-parser.utility.ts:81`), Hono < 4.12.21, Axios < 1.18.0, `js-yaml@4.1.1`. | `package.json`, `frontend/package.json` | **[X]** |
| **B5** | **Actions-menu items likely never fire.** Outside-click listener is on `mousedown` and tests containment against the *trigger* only; menu items live in a `createPortal` to `document.body`. Pressing an item → `mousedown` → `setOpen(false)` → React flushes before `click` is dispatched → button unmounted → `onClick` never runs. **Verify by hand — this may mean the entire feed actions menu is non-functional.** | `FeedActionsMenu.tsx:17-25, 68-90` | **[C]** |
| **B6** | **Double-submit creates duplicate feeds.** The header Publish/Save button (`formRef.current?.submit()`) has no `disabled` state and no knowledge of `isSubmitting`. The correctly-guarded in-form button is gated behind `show("output")`, so on every step but the last the unguarded header button is the only one. | `BuildFeedPage.tsx:175-181` vs `FeedBuilderForm.tsx:55, 447-463` | **[C]** |
| **B7** | **Draft autosave writes secrets to localStorage.** Redaction is a denylist (`emailPassword`, `cookies`, `headers`, `apiBody`…) that misses `webhookToken` (`types/feed.ts:316`), `webhookTokenHash` (`:317`), `serviceConnectorApiKey` (`:343`), and `formFields` (POST form-scraping credentials). It will drift further with every new feed type. Invert to an allowlist. | `useFeedDraft.ts:12-25` | **[C]** |

### High

| ID | Finding | Location | Src |
|---|---|---|---|
| **C1** | **Simulated progress.** A 12-step named analysis checklist advanced by `setInterval(…, 400)` with no backend signal — the comment says `// Simulate step progression`. Fast responses skip the whole thing; slow ones park on step 10, falsely implicating a stage. Interval never cleared on unmount; the `catch` discards the error. | `SourceAssistantPanel.tsx:185-198` | **[C+X]** |
| **C2** | **Fabricated preview output.** `PreviewPanel` hard-codes two sample articles and renders them as an RSS "Raw Data Output Console" throughout the builder, including before any source is configured. **[C] adds:** the XML is built by raw string interpolation of live user input with **no escaping** — an `&` or `<` in the feed name produces malformed XML in the panel presented as the user's output. `pubDate` is `Date.now()`-relative so it always looks freshly generated. | `PreviewPanel.tsx:8-42` | **[X]**, extended by **[C]** |
| **C3** | **Front-end lint is excluded from the only quality gate.** `biome.json:10` → `"includes": ["**", "!frontend", "!public"]`. An isolated run found **70 errors / 160 warnings across 102 files**: 26 buttons without `type`, 20 SVG a11y diagnostics, 4 click handlers without keyboard equivalents, 3 interactive static elements, 3 unassociated labels, 2 stale-effect dependency errors, 96 explicit-`any`. This is the single reason most other front-end findings survived to review. | `biome.json:10` | **[X]** |
| **C4** | **Every toast triggers two full feed refetches.** `<Ctx.Provider value={{ push, dismiss }}>` — a fresh object every render, unmemoised. `loadFeeds` has `[toast]` in its `useCallback` deps and `useEffect(…, [loadFeeds])` re-runs on identity change. `ToastProvider` re-renders on every push *and* every 4.2 s auto-dismiss → two extra `GET /api/feeds` per toast, and the list flickers back to server state seconds after any optimistic update. Fix: `useMemo`. | `toast-provider.tsx:20` + `MyFeedsPage.tsx:46-59` | **[C]** |
| **C5** | **Optimistic mutations diverge from server state.** `handleUpdate` awaits the metadata PATCH and never checks `res.ok` — a 500 resolves, `catch` never runs, the UI shows saved. Enable/disable check status but have no network-error catch, leaving optimistic state plus an unhandled rejection. (`catch` also comments `// Revert` then calls `loadFeeds()`, a refetch.) | `MyFeedsPage.tsx:85-103, 147-176` | **[C+X]** |
| **C6** | **Health and Settings unreachable below `lg`.** Sidebar is `hidden … lg:flex`; `BottomNav` offers only Feeds / Create / Catalog. Below 1024 px — every tablet in portrait — `/health` and `/settings` require typing the URL. | `Sidebar.tsx:41`, `BottomNav.tsx:12-42` | **[C+X]** |
| **C7** | **New feed types inherit irrelevant Web Scraping steps.** `getSections()` has dedicated models only for API, Email and Feed Transformer; **6 of 10 types** get `Basic → Headers & Cookies → Selectors → Output → Advanced`. **[X] observed** Sitemap's "Selectors" step showing the same URL/limit fields with no selector controls — steps that look functional but advance nothing. | `BuildFeedPage.tsx:67-72`, `FeedBuilderForm.tsx:417-422` | **[C+X]** |
| **C8** | **Feed detail drawer is not a dialog.** No `role="dialog"`, `aria-modal`, focus trap, focus-on-open, focus restore, or Escape handler. Scrim is an interactive `<div>`. Background is not inert — Tab walks behind the drawer. `@radix-ui/react-dialog` is already used elsewhere in the app. | `FeedDetailDrawer.tsx:50-89` | **[C+X]** |
| **C9** | **Default secondary text fails WCAG AA.** `--muted-foreground` on `--background` = **4.34:1** (needs 4.5) — the app's default secondary text colour, on every screen. `--wb-outline` on card = **1.70:1** (needs 3.0, WCAG 1.4.11) — the default border colour. Eight further failures in §4. | `index.css:18, 40` | **[C]** |
| **C10** | **13 `alert()` calls as the primary feedback channel**, in an app shipping a `ToastProvider` — including success confirmations with `\n\n`-formatted feed URLs and an alert used as a success toast (`SelectorPlayground.tsx:61`). Both audits counted exactly 13. | 5 files | **[C+X]** |
| **C11** | **No error boundary and no 404 route.** Zero `ErrorBoundary` / `componentDidCatch` / `Suspense` / `React.lazy` in the codebase; no `path="*"`. Any render throw blanks the entire app — and `MyFeedsPage.tsx:67` calls `f.sourceUrl.toLowerCase()` on a field derived from ten different config shapes. | `App.tsx`, `main.tsx` | **[C]**, listed as a test gap by **[X]** |
| **C12** | **E2E startup is not cross-platform.** `playwright.config.ts:31` uses POSIX inline env assignment (`PASSKEY=admin123 bun index.ts`). On Windows — the platform this repo is developed on — `bun run test` exits before any browser launches. With servers started manually, **[X]** confirmed 12/12 pass. | `frontend/playwright.config.ts:31` | **[C+X]** |
| **C13** | **`starter-configs/` is architecture theatre.** Nine files named `<route>.adapter.ts`, each a **single line** re-exporting the same `buildStarterConfig` under a different alias. No per-route adapters exist. Sibling `scorers/`: seven of ten are one ternary; `service-connector.scorer.ts` is `() => null` in full — a scorer that never scores, registered in the pipeline. | `utilities/source-assistant/starter-configs/*.adapter.ts`, `scorers/` | **[C]** |

### Medium — grouped

Full detail for each is in `mkfd-audit-claude-0526.md` §4–§10 and the Codex audit §P2.

**Data / logic**
- **D1** Chart day-grouping uses a localised date string as key and emits `Object.values()` in insertion order — x-axis can run backwards in time, and `"Jan 5"` from two years collapses into one bucket. `OverviewTab.tsx:46-55` **[C]**
- **D2** No `.catch()` on the health chart fetches — a failed response leaves charts permanently empty, indistinguishable from "no data". `OverviewTab.tsx:37`, `FeedHealthTab.tsx:14` **[C]**
- **D3** N+1: one `Sparkline` fetch per feed on the Health tab. `FeedHealthTab.tsx:12-18` **[C]**
- **D4** `EventSource` `onerror` is empty with a comment claiming auto-reconnect; on a fatal error it sets `CLOSED` and never reconnects, freezing the dashboard silently. `useHealthStream.ts:107` **[C]**
- **D5** Ref assigned during render (`onRunRef.current = onRun`) — a side effect in the render body, unsafe under StrictMode. `useHealthStream.ts:93` **[C]**
- **D6** `watch()` with no arguments feeding effect dependency arrays, with the result propagated to parent state — canonical RHF render-loop footgun; at minimum re-renders the whole builder tree on every keystroke. `FeedBuilderForm.tsx:143, 156-166` **[C]**
- **D7** `ResizeObserver` on the scroll container (fixed `flex:1` box) rather than its content — filter arrows never appear when tags load asynchronously. `ScrollableFilterRow.tsx:20-31` **[C]**
- **D8** Clipboard writes unawaited with no `.catch()`; success toast fires regardless. `FeedDetailDrawer.tsx:30` gives no feedback at all. Export revokes the object URL synchronously after `click()`, racing the download (cancels it in Firefox) and never appends the anchor. `MyFeedsPage.tsx:111, 136-141` **[C]**
- **D9** `"open"` and `"preview"` cases are byte-identical; the menu offers both as separate items. `MyFeedsPage.tsx:107-115` **[C]**
- **D10** Backend error→status mapping by `e.message.includes("not found")`, duplicated across five handlers; any internal error containing that phrase becomes a 404. Two different validation strategies in one file. `routes/feeds.ts:242-248, 394-490` **[C]**
- **D11** One `AbortController` across 33 `fetch` sites; no timeout on `/source-assistant/analyze`, which performs server-side remote fetching. **[C]**
- **D12** Filter/search/view state is neither in the URL nor persisted — refresh loses everything, views can't be shared. (Sidebar collapse *is* persisted, inconsistently.) `MyFeedsPage.tsx:39-44` **[C]**
- **D13** No unsaved-changes guard anywhere. `SettingsPage` tracks `isDirty` and does nothing with it; `BuildFeedPage` discards a half-built feed on one click. **[C]**

**AI code smells / dead code**
- **E1** **Seven copies of the feed-type label map** and three copies of the same eight SVG icons (byte-identical between `FeedTypeBadge` and `TypePickerGrid`), while `lucide-react` already provides all eight and is imported for a third rendering. **Two live bugs result:** `FeedBuilderForm.tsx:342`'s nested ternary names only 4 of 10 types so the Basic badge literally reads `serviceConnector` / `graphql` / `filesystem`; and the builder's type vocabulary diverges from `FeedType`, so a Feed Transformer feed renders in My Feeds as a **blue globe labelled "Scrape"** via `TYPE_META[type] ?? TYPE_META.scrape`. **[C]**
- **E2** `active: true` on all ten entries gates ~20 lines of unreachable UI — a `SOON` badge, `disabled`, `not-allowed`, `opacity 0.6` and six ternaries that can never take their false branch. `TypePickerGrid.tsx:14-194` **[C]**
- **E3** `buildFeedConfigFromFormData` is `return data as unknown as Record<string, unknown>` with three comments explaining it does nothing. Consequence: `defaultValues` seeds **all ten feed types at once**, so creating an email feed POSTs `graphqlItemPath`, `serviceConnectorService: "jellyfin"`, `sitemapMaxItems` and ~30 more keys into its YAML. `lib/feed-config-builder.ts`, `FeedBuilderForm.tsx:59-123` **[C]**
- **E4** **Unearned precision:** the confidence meter renders "74% — Medium confidence" from `confidence: 0.74` hard-coded next to a `url.includes("graphql")` substring test. Every scorer does this (0.8 / 0.74 / 0.45 / 0.25 / 0.2). **[C]**
- **E5** Calendar scorer broken in both directions: `/ical|ics|calendar/i.test(obs.contentType ?? obs.finalUrl)` tests contentType *instead of* URL when present (misses `.ics` served as `text/plain`), and when absent matches `ics` inside `/topics/`, `/politics/`, `/physics/` → "Use calendar feed" at 0.8, the top recommendation. `scorers/calendar.scorer.ts:2` **[C]**
- **E6** **253 lines of fully orphaned components** — `SectionPager.tsx` (62), `KVEditor.tsx` (165), `SectionHeader.tsx` (26) have **zero references anywhere in the codebase**. Additionally `BuilderLayout` declares `sections`, `activeSection` and `onSectionChange` in its props interface, destructures **only** `preview, children`, and silently ignores all three — while `BuildFeedPage.tsx:225-227` passes them. *(Found while cross-verifying [X]'s B2; in neither original audit.)* **[new]**
- **E7** Further dead surface: `hide-scrollbar` class (undefined, so WebKit still paints the global scrollbar inside the filter row), `.gradient-border` / `.slide-up` / `.slide-down` (0 usages), `--chart-1…5` (defined light+dark, 0 usages), `isStale` + `setLastUrl` (exported, consumed by nothing), `onPickType` (destructured as `_onPickType` and discarded while the parent passes a real handler), `Field`'s `hint` prop (0 of 36 call sites), `FeedTable`'s unreachable empty state, legacy `POST /delete-feed` duplicating `DELETE /api/feeds/:id` with a *different* sanitiser, two unimported SVG assets. **[C]**
- **E8** Unused dependencies: `zod` and `@hookform/resolvers` have **zero imports** (an abandoned validation plan). `readline` (a Node builtin) and `bun` (the runtime) are listed as runtime deps; `bun-types` duplicates `@types/bun`; `@types/xml` present with no `xml` package. **[C]**
- **E9** Two byte-identical `Switch` components (`SettingRow.tsx:78`, `SettingsTab.tsx:33`), neither in `components/ui/`; the second has no accessible name. 19 hand-written field coercions that should be a loop (`FeedBuilderForm.tsx:218-239`). Three near-identical page shells in `SettingsPage.tsx:223-301`. 98 decorative `// ---` banner comments. **[C]**

**Design system**
- **F1** **Three token systems that don't agree** — shadcn HSL, `--wb-*` hex, and `feeds-tokens.css` aliases — mixed within single style objects (`SettingRow.tsx:33-35`, `TypePickerGrid.tsx:169-176`), plus **120 hard-coded hex colours** across 14 files. Commit `32d690d` ("replace remaining hardcoded badge hex colors") never reached `FeedStatusBadge` or `FeedTypeBadge`, which remain 100% hard-coded. **[C]**
- **F2** The feeds token scale is decorative: `--ink-2` ≡ `--ink`, `--ink-4` ≡ `--ink-3`, `--line-strong` ≡ `--line`, `--brand-ink` ≡ `--brand`. A four-step ink ramp with two values. And it is imported from a *leaf page* (`MyFeedsPage.tsx:3`) while consumed elsewhere — two consumers already carry defensive `var(--shadow-pop, …)` fallbacks. **[C]**
- **F3** **Dark mode can never activate.** `darkMode: ["class"]`, 25 dark tokens, `dark:` variants in components — and nothing anywhere adds the class. If it were added the result would break: the entire `--wb-*` system has no dark variant, so white cards would sit behind near-white `--foreground`. **[C]**
- **F4** **The redesign's fonts never load.** `"Geist"` and `"JetBrains Mono"` are referenced in five places with no `@font-face`, no `<link>`, and no font package. The whole typographic identity silently falls back to system stacks. **[C]**
- **F5** Custom `.animate-in` / `.fade-in` in `index.css:178-184` collide with `tailwindcss-animate`'s primitives, which every Radix dialog / tooltip / select depends on — their enter animations are overridden by a 10 px translateY and the plugin's CSS variables ignored. **[C]**
- **F6** Off-brand orange `LoadingSpinner` with `bg-white` / `text-slate-700`; empty state renders a literal blank 48 px grey square with no CTA; a `<style>` block with `@keyframes` injected into the drawer's render tree; ad-hoc z-index across five scales (50 / 100 / 300 / 301 / 9999 — the actions menu renders above the drawer's modal scrim); six text glyphs used as icons where lucide equivalents are already imported. **[C]**

**Accessibility** *(full inventory in [C] §6)*
- **G1** **34 ARIA attributes and 2 roles in 11,440 lines.** Zero `aria-live`, `aria-expanded`, `aria-pressed`, `aria-current`, `aria-invalid`, `aria-describedby`, `aria-selected`, `aria-busy`, `aria-modal`, `aria-sort`. No `role="dialog"`, `tablist`, `status`, `alert`, `menu`, or `group`. **[C]**
- **G2** Toasts have no `role="status"` / `aria-live` — every success and failure message in the app is silent to assistive technology; the dismiss `×` has no label; the container overlaps `BottomNav` on mobile. **[C]**
- **G3** Selection state never exposed: quick-filter chips (mutually exclusive, no `aria-pressed` / radiogroup), type and tag chips, view toggle, and the builder step strip — which is styled and labelled as a tablist with none of the tablist semantics or arrow-key navigation. **[C]**
- **G4** Keyboard-unreachable click targets: `<td onClick>` for row detail (`FeedTable.tsx:22`), `<Card onClick>` for the whole feed-health list (`FeedHealthTab.tsx:57`), plus interactive scrim divs. **[C+X]**
- **G5** `Field`'s `htmlFor` is optional; nine call sites omit it, producing labels bound to nothing. `hint` has no `aria-describedby`. The "required" pill is purely visual. Search input is placeholder-only. Radix checkboxes in Calendar/Filesystem/Webhook forms are unlabelled. 114 placeholders vs 107 `htmlFor` across 125 inputs. **[C+X]**
- **G6** Focus ring removed on the primary search control (`outline-none` + a ~2:1 border change) — WCAG 2.4.7. `index.css:246` confirms a global focus block was deliberately deleted. **[C]**
- **G7** Status by colour alone: bare health dots with no text or label; the stacked bar chart has `name` props but **no `<Legend>`**, so success vs error requires hovering; no text alternative on any of the four charts; `FeedTypeBadge` at its default `showLabel={false}` has no accessible name in the table. **[C]**
- **G8** No `<h1>` on the builder's landing state; `<h1>` buried below the stat tiles on My Feeds; h1→h3 skips on Settings and Health; no skip-link, no landmark labels, static `<title>Feed Builder</title>` for all six routes (and off-brand). **[C+X]**
- **G9** No `prefers-reduced-motion` anywhere, against four custom keyframes plus `tailwindcss-animate`, `animate-spin`, `animate-pulse`, a sidebar width transition and an injected drawer animation. **[C]**

**Build / infra**
- **H1** 943.22 kB JS / 281.61 kB gzip, single chunk. `manualChunks: undefined` explicitly disables Rollup's automatic splitting; all pages eagerly imported; zero `React.lazy`. `recharts` (~400 kB) loads on the builder route, which never charts. **[C+X]**
- **H2** No reproducible root type-check: no `typecheck` script, and current TypeScript fails on `moduleResolution: "node"` (removed node10 behaviour) plus `bun-types` unresolvable under the narrowed `typeRoots`. **[X]**
- **H3** Committed credentials in two files — `package.json:9` and `playwright.config.ts:31` both ship `PASSKEY=admin123` and a cookie secret that is the 16-char encryption key repeated twice. **[C]**
- **H4** Backend hardening gaps beyond A2: timing-unsafe passkey comparison, no rate limiting on `/passkey`, no security headers (CSP / X-Frame-Options / X-Content-Type-Options), `configs/` served statically, `process.exit()` on SIGTERM with no drain of in-flight feed runs, ten routers all mounted at `"/"`, hard-coded port. **[C]**
- **H5** 227 `any` and 118 raw `console.*` in the backend with no structured logger; startup proceeds silently degraded when DB init fails, with no health or readiness signal. **[C]**

---

## 3. Reconciled metrics

Where the audits differ, both counts are correct under different rules:

| Metric | **[C]** | **[X]** | Reconciliation |
|---|---|---|---|
| `any` in front end | 73 | 99 | [C] counted `as any` assertions; [X] counted all `any` tokens (incl. annotations and Biome's 96 warnings). Use **99** for the lint-debt figure, **73** for type-assertion escapes. |
| Inline `style={{}}` | ~370 | 334 | Different regexes over the same pattern. Order of magnitude agreed; use **~340**. |
| `alert()` calls | 13 | 13 | Exact agreement. |
| Bundle | 944 kB | 943.22 kB / 281.61 gzip | [X]'s is the measured build output — use it. |
| ARIA attributes | 34 | — | [C] only. |
| Hard-coded hex | 120 | — | [C] only. |
| Root vulnerabilities | — | 58 (1 crit / 18 high) | [X] only — requires `bun audit`. |
| FE lint findings | — | 70 err / 160 warn / 102 files | [X] only — requires an isolated Biome run. |
| Backend tests | — | 438 passed | [X] only. |
| e2e | 5 specs / ~137 lines, Chromium-desktop only | 12 tests, 12 passed (manual start) | Both: [C] counted files/lines, [X] counted and ran test cases. |

---

## 4. Contrast measurements

Computed by **[C]** (sRGB, WCAG 2.x). No equivalent in **[X]**.

| Pair | Ratio | Verdict |
|---|---|---|
| `--muted-foreground` on `--background` — **default secondary text** | **4.34** | **FAIL** (needs 4.5) |
| `--wb-outline` `#c3c7cb` on card — **default border** | **1.70** | **FAIL** (needs 3.0, WCAG 1.4.11) |
| `.workbench-chip-success` on its 14% tint @ 10 px/700 | **3.17** | **FAIL** |
| `.workbench-chip-error` on its 14% tint @ 10 px/700 | **3.96** | **FAIL** |
| `--wb-success` on card at body sizes | **3.73** | **FAIL** |
| `--wb-warning` on card at body sizes | **3.99** | **FAIL** |
| Toast body text `rgba(255,255,255,.7)` on `#166534` | **3.40** | **FAIL** |
| Toast close `×` `rgba(255,255,255,.5)` on `#991b1b` | **2.47** | **FAIL** |
| `FeedStatusBadge` "disabled" @ 11 px | **4.34** | **FAIL** |
| Favourite star `#f59e0b` on white (UI icon, needs 3.0) | **2.15** | **FAIL** |
| `FeedStatusBadge` healthy / warning / error / running | 7.80 / 7.78 / 7.78 / 6.97 | pass |
| `FeedTypeBadge` all eight | 8.07 – 9.45 | pass |
| `--wb-muted` on `--wb-surface` | 8.89 | pass |

The first two are the highest-leverage fixes in the entire audit — they are the app's default secondary-text and border colours. Darkening `--muted-foreground` to ~`hsl(204 9% 40%)` and `--wb-outline` to ~`#9aa0a6` clears both, everywhere, in two lines.

Note: the stat tiles render `--wb-success` / `--wb-warning` at 28 px/650, which qualifies as large text (3:1) and passes — the same tokens fail at every other size they appear at.

---

## 5. Merged release plan

Both audits proposed an order; this reconciles them, inserting the security findings **[X]** did not have and the verification gates **[C]** did not have.

### Gate 0 — security (do first; A1/A2 are pre-existing but should not ship again)
1. **A1** Remove `allow-same-origin` from the proxy iframe, or serve `/proxy` from a separate origin with `CSP: sandbox; script-src 'none'`.
2. **A2** Make the local-auth bypass explicit opt-in (`--trust-local`, default off); never treat an indeterminate address as local.
3. **B7** Invert draft redaction to an allowlist.
4. **H3** Move committed dev credentials to a git-ignored `.env.local`.

### Gate 1 — release blockers
5. **B1** Exhaustive route→form mapping; form-shaped starter data for every `SourceAssistantRouteType`; one apply-flow test each. *(The `calendar: "email"` line is a one-token fix; the starter-config fallback is the real work.)*
6. **B2** Responsive `BuilderLayout` — full-width form below the desktop breakpoint, preview into a drawer/step; scrollable or compact step strip.
7. **B3** Real soft-delete/restore, or drop Undo and require confirmation.
8. **B4** Upgrade runtime deps; replace `xmldom` with a maintained parser (it parses untrusted fetched feeds); surface `bun audit` in CI.
9. **B5** Verify and fix the actions-menu outside-click handler.
10. **B6** Thread `isSubmitting` to the header button.
11. **C1** Real progress events or an honest indeterminate spinner.

### Gate 2 — make the gates real (this is why the rest survived to review)
12. **C3** Give `frontend` its own checked-in Biome config and `lint` script; run in CI.
13. **H2** Deterministic root `typecheck` script; pin a supported TypeScript or adopt Bun's type setup.
14. **C12** Cross-platform e2e startup; add Windows CI if Windows is supported.
15. Add a 390 px mobile Playwright project and `@axe-core/playwright` on representative flows — **[X]**'s B2 was only found by measuring, and **[C]**'s C6 was only found by reading the breakpoint.

### Gate 3 — correctness and a11y
16. **C4** Memoise the toast context value, then re-audit `useToast()` consumers in dependency arrays.
17. **C11** Error boundary at `AppShell` plus a `*` route.
18. **C5** Centralise mutations: require `response.ok`, snapshot the previous object, roll back on HTTP *and* network errors.
19. **C6** Health + Settings in `BottomNav` (or a More menu).
20. **C9** Fix `--muted-foreground` and `--wb-outline`, then the eight remaining failures.
21. **C8** Rebuild the drawer on `@radix-ui/react-dialog`.
22. **C10** / **G2** Route all 13 alerts through `useToast()`; add `role="status"` + `aria-live` to the toast container.
23. **G3–G7** `aria-pressed`/`aria-current` on all toggles; keyboard access for `<td>`/`<Card>` targets; make `Field`'s `htmlFor` required; add the chart legend.
24. **C2** Label the preview panel unmistakably as an example or replace it with an empty state — and escape the interpolated XML.
25. **D1–D13** as scheduled.

### Gate 4 — consolidation
26. **E1** One `FEED_TYPES` registry (id, label, description, lucide icon, tokenised colours) consumed by all seven current sites; reconcile the builder and summary type vocabularies.
27. **E6/E7/E8** Delete the orphaned components, dead CSS and unused dependencies — roughly a third of the front-end findings resolve by deletion alone.
28. **C13/E2/E3** Collapse the nine alias adapters into one import; delete the `active` flag and its unreachable branches; make `buildFeedConfigFromFormData` filter by feed type or delete it.
29. **F1–F5** Pick one token system; add `--wb-*` dark values or delete dark mode outright; load the two fonts; rename the colliding animation utilities.
30. **H1** Route-split with `React.lazy`; isolate recharts.

---

## 6. What each audit uniquely contributed

Recorded because it is the useful lesson for the next review cycle.

**Only [X] found — all required execution:**
- B2 mobile builder collapse (measured at 390×844)
- B4 the 58 + 15 dependency vulnerabilities
- C3 front-end lint excluded from `biome.json` — the governance failure that let most of the rest through
- H2 root type-check not reproducible
- C2 the fabricated preview panel
- 438 backend tests pass / 12 e2e pass
- Real bundle numbers

**Only [C] found — all required exhaustive reading:**
- A1, A2 — both Critical security issues
- B5, B6, B7 — three functional/security blockers
- C4, C11, C13 — refetch loop, missing error boundary, the fake adapter architecture
- C9 + the whole contrast table
- D1–D13 — thirteen data-flow and lifecycle defects
- E1–E5, E7–E9 — the duplication and dead-code inventory, including two user-visible label bugs
- F1–F6 — the entire design-system layer (three token systems, dead dark mode, unloaded fonts, animation collision)
- G1–G3, G6–G9 — the ARIA census and most a11y specifics
- H3–H5 — committed credentials, backend hardening, backend code quality

**Found only by cross-checking the two:**
- E6 — 253 lines of orphaned builder components (`SectionPager`, `KVEditor`, `SectionHeader`) plus `BuilderLayout`'s three ignored props, surfaced while verifying [X]'s B2.
- C2 extension — the preview XML is unescaped user input, surfaced while verifying [X]'s P2.

**Takeaway:** the two methods are complementary and neither is sufficient alone. A static-only pass misses anything that needs to run; an execution-focused pass misses anything the tooling isn't configured to check — and here the tooling was configured to skip the entire front end.

---

## 7. Shared conclusion

Both audits reach the same verdict by different routes: **substantial, competent work that is not release-ready**, with the debt concentrated almost entirely in the front end.

Both independently identified the same signature — the branch repeatedly ships *structure that signals completeness without delivering it*. **[X]** named it in the fabricated preview console and the simulated progress bar. **[C]** found the same habit in nine adapter files that are alias re-exports, a four-level ink ramp with two values, a confidence meter fed by hard-coded decimals, a dark theme with no toggle, a typographic system whose fonts never load, an `active` flag that is always true, and seven copies of one label map — one of which shows users the raw string `serviceConnector`.

Neither audit found this in the backend, which is genuinely well-built: the route decomposition is a real improvement on the 1,900-line `index.ts` it replaces, the outbound-fetch policy correctly re-validates redirects (the part most SSRF guards get wrong), `assertSafeFeedId` is a strict allowlist, and 438 tests pass across 33 new suites.

The correct reading is that the branch's engineering discipline held wherever a quality gate was watching and did not hold where none was. `biome.json:10` excludes `frontend`. There is no root type-check. The e2e suite doesn't start on the development platform and runs only desktop Chromium. Fixing those four things (Gate 2) is what prevents the next 90k-line branch from arriving in the same condition — and should be sequenced ahead of most of the individual fixes it will surface.

---

## 8. Dedicated security audit addendum — 2026-09-02

### 8.1 Scope and verification

This pass reviewed the branch as a self-hosted, single-operator application, but did **not** assume that authentication makes server-side fetches, remote content, webhooks, browser automation, or deployment defaults trustworthy. Those are the principal trust boundaries in mkfd.

Review coverage:

- authentication, session cookies, local-client trust, CSRF, and security headers;
- secret collection, storage, masking, subprocess transfer, and cryptography;
- every located outbound HTTP sink, including redirects, DNS resolution, Playwright, FlareSolverr, connectors, drill chains, and outgoing webhooks;
- filesystem path confinement and static serving;
- request/response size, persistence, regex, and scheduled-work resource limits;
- runtime and front-end dependency advisories as of 2026-09-02;
- Docker build/runtime defaults and supply-chain controls;
- targeted tracked-file credential-pattern search and the security-relevant test inventory.

Verification results:

| Check | Result |
|---|---|
| `bun test tests/` | **438 passed, 0 failed**, 724 assertions, 37 files |
| Root `bun audit --json` | **58 advisories:** 1 critical, 18 high, 35 moderate, 4 low |
| Front-end `bun audit --json` | **15 advisories:** 8 high, 5 moderate, 2 low |
| Installed security-relevant versions | `axios@1.16.1`, `hono@4.12.18`, `hono-sessions@0.7.3`, `js-yaml@4.1.1`, `node-forge@1.4.0`, `xmldom@0.6.0` |
| Existing security tests | Good unit coverage for IP-range classification, redirect revalidation on the standard fetch path, protected-value round trips/masking, webhook token comparison, and filesystem path confinement |
| Missing security tests | No end-to-end authorization-boundary tests, proxy/reverse-proxy address tests, browser-to-localhost CSRF tests, body-limit tests, DNS-rebinding tests, AEAD tamper tests, subprocess-secret tests, or coverage ensuring every network sink uses one policy |

No additional finding was promoted above the two existing standalone Critical issues A1 and A2. Several High findings below become Critical attack chains when combined with A1 or A2.

### 8.2 New and expanded security findings

#### S1 — High — the encryption master key crosses process and output boundaries in plaintext

`workers/imap-feed.worker.ts:126-145` passes the application-wide encryption key to every IMAP subprocess as `--key=<encryptionKey>`. Command-line arguments can be exposed by process inspection and crash/diagnostic tooling. The child then prints the key verbatim at `node/imap-watch.utility.ts:487`:

```ts
console.log(`[IMAP Node Watcher] Process started for hash: ${configHash} with key: ${encryptionKey}`);
```

That output is currently piped to the parent and discarded when it is not JSON, which reduces ordinary console exposure but does not make emitting a master key safe. Any stdout collector, changed pipe behavior, debug capture, or process inspection exposes the key that decrypts **all** protected feed credentials. The interactive fallback in `index.ts:42-72` also collects all three secrets through normal `readline.question`, which echoes input.

Required fix:

1. Never include secret values in logs, errors, process titles, or command arguments.
2. Give the child the key over a deliberately private IPC/stdin channel, or redesign the worker so decryption remains in the parent and only the minimum resolved credential is transferred.
3. Use a hidden-input prompt for interactive secret entry.
4. Add a regression test that captures child arguments/stdout/stderr and asserts that neither plaintext secrets nor ciphertext keys appear.
5. Treat any deployment that has run an IMAP feed under log/process collection as potentially exposed; rotate `ENCRYPTION_KEY` and re-encrypt stored secrets after the code fix.

#### S2 — High — protected-value encryption is unauthenticated AES-CBC with ad-hoc key handling

`utilities/security.utility.ts:4-35` encrypts secrets with AES-CBC, stores `base64(IV || ciphertext)`, and provides no MAC or authentication tag. Ciphertext changes therefore are not reliably detected before decryption. The key is the first 32 UTF-8 bytes returned by a Forge buffer rather than a versioned, validated 256-bit key or a password-derived key. Startup accepts any non-empty key (`index.ts:53-79`) even though AES accepts only specific key sizes, and keys longer than 32 bytes silently share the same effective prefix. Decryption also calls `.trim()`, corrupting valid credentials with intentional leading/trailing whitespace.

This applies to mkfd's protected feed values, not the session cookie: `hono-sessions` uses an Iron sealed-cookie construction separately.

Required fix:

1. Replace the format with a versioned authenticated-encryption envelope using AES-256-GCM (or another reviewed AEAD): version, nonce, ciphertext, and authentication tag.
2. Require a randomly generated 32-byte key encoded in a documented form; if human passwords are supported, derive a key using a reviewed KDF with a per-installation salt and cost parameters.
3. Reject placeholders, invalid lengths, and low-quality defaults at startup. Do not trim decrypted bytes.
4. Implement an explicit read-old/write-new migration and key-rotation procedure; do not silently reinterpret existing CBC data.
5. Test tampering, wrong keys, truncated envelopes, whitespace-preserving round trips, migration, and rotation.

This follows OWASP's recommendation to prefer authenticated modes such as GCM/CCM and to manage key lifecycle separately from encrypted data: [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).

#### S3 — High — the outbound-fetch policy is fragmented; several SSRF-capable sinks bypass it

The earlier report's statement that redirect handling is correct is true for `axiosGetWithPolicyRedirects` and consumers of `executeWithFetchPolicy`. It is **not** true application-wide.

Confirmed gaps:

| Sink | Security gap |
|---|---|
| `utilities/data-handler.utility.ts:168-256, 320-388` | `resolveDrillChain` follows initial and page-extracted URLs through Axios, Playwright, or FlareSolverr without calling the outbound policy. A public page can change a selected link to an internal or metadata URL after a feed has been configured; extracted response content can then flow into a public feed. |
| `utilities/calendar-feed.utility.ts:17-19` | Direct `axios.get`; no redirect revalidation or response-size cap. The worker/preview checks the initial URL, but Axios resolves/follows it again. |
| `utilities/sitemap.utility.ts:52-55` | Same direct-fetch gap; the entire remote XML document is parsed before `maxItems` is applied. |
| `utilities/graphql-feed.utility.ts:6-20` | Direct `axios.post`; no central redirect policy or response-size cap. |
| `utilities/service-connectors/jellyfin.connector.ts:23-48` and `routes/service-connectors.ts:11-36` | Connector test, resource, and preview routes make direct requests. The interactive routes do not perform even the initial outbound-policy check. |
| `utilities/webhook.utility.ts:32-150` | User-configured outgoing webhook URLs are posted to directly, with normal Axios redirect behavior and no private-network/metadata policy. |
| `utilities/preview-generator.utility.ts:65-166` and `workers/feed-updater.worker.ts:181-286` | Playwright and FlareSolverr paths check the submitted starting URL and resolver endpoint, but do not intercept/validate target redirects, subresources, service-worker requests, or URLs subsequently selected by remote page script. |

The central validator itself has a DNS time-of-check/time-of-use gap: `assertOutboundFetchAllowed()` resolves the hostname for validation (`outbound-fetch-policy.utility.ts:386-405`), then Axios/Playwright resolves it again when connecting. An attacker-controlled DNS server can provide a public answer for the check and a private answer for the connection. Standard redirect revalidation does not close that gap.

Required fix:

1. Create one network-execution boundary used by **every** HTTP(S) operation—GET, POST, connectors, webhooks, drill chains, preview, worker, and utilities. Prohibit direct Axios/fetch/browser navigation outside that module with a lint/architecture test.
2. Resolve once, validate **all** returned addresses, connect to a validated address through a custom lookup/agent, and preserve the original hostname for TLS SNI and `Host`; do not perform an independent second DNS lookup.
3. Revalidate every redirect and constrain schemes, credentials-in-URL, ports, and normalized hostnames.
4. For Playwright, intercept every request with `page.route`/context routing, apply the same destination policy, and disable or explicitly govern service workers. Treat FlareSolverr as a separate privileged network service with egress controls; application-side checking of its API endpoint does not constrain where it browses.
5. Apply the policy to outgoing webhooks as well as imports/fetches. Prefer network-level egress denial of metadata and internal ranges as a second layer.
6. Add integration tests for DNS rebinding, redirect-to-private, page subresources, page-extracted drill URLs, webhook redirects, and each source/connector type.

OWASP explicitly calls out DNS rebinding and URL-validation TOCTOU, and defines SSRF to include both importing from and publishing to attacker-controlled URLs: [OWASP SSRF Prevention in Node.js](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html), [OWASP SSRF overview](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery), and [OWASP Top 10 A10](https://owasp.org/Top10/2021/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/).

#### S4 — High — the Settings page's network controls are not connected to enforcement

`allow_private_fetches` and `outbound_fetch_allowlist` are Class A, database-writable settings in `utilities/app-settings.utility.ts:128-151`, and the UI reports successful saves. The enforcing code does not read those effective settings:

- `getGlobalFetchPolicyOptions()` reads only `process.env` (`outbound-fetch-policy.utility.ts:272-276`);
- the worker independently reads only `process.env` (`workers/feed-updater.worker.ts:98-114`);
- `resolveFetchPolicy()` calls the same environment-only function (`fetch-policy.utility.ts:26-40`).

Consequently, the UI can say private fetches are disabled while the running policy remains enabled by environment, or say an allowlist was changed when requests continue under the old value. This is a security-control integrity failure, not only a settings bug.

`mergeFeedPolicyOptions()` also lets feed data override `allowPrivateFetches` and unions a feed allowlist into the global one (`outbound-fetch-policy.utility.ts:290-305`). Most normal form casting currently drops those fields, but the transformer probe merges the request body directly (`routes/feeds.ts:73-82`) and manually authored/imported config can carry them. A per-feed object must not be able to weaken an administrator's global deny policy unless that is an explicit, separately authorized capability.

Required fix: establish one authoritative effective-settings snapshot available to routes and workers; make the global rule a ceiling that feed configuration can only tighten; version/cache-invalidate it predictably; display the actually enforced value; and add a save→enforcement integration test in both route and worker contexts.

#### S5 — High — shipped Docker defaults permit known credentials and insecure exposure

`docker-compose.yml:5-21` publishes port 5000 and supplies known placeholders as live defaults:

```yaml
PASSKEY=${PASSKEY:-your_passkey_here}
COOKIE_SECRET=${COOKIE_SECRET:-your_cookie_secret_here}
ENCRYPTION_KEY=${ENCRYPTION_KEY:-your_encryption_key_here}
SSL=${SSL:-false}
```

The application checks only that the values are non-empty, so it accepts the published passkey/encryption placeholder. The cookie placeholder is shorter than the session library's documented 32-character recommendation and may fail only when a cookie is sealed. This turns an omitted `.env` into either predictable authentication or a partially broken security configuration. Combined with A2, reverse-proxy/container deployment is unsafe even when the operator changes these defaults.

Required fix:

- make all three Compose variables required (`${VAR:?message}`), refuse documented placeholders and weak/invalid values at startup, and provide a secure key-generation command;
- bind Compose to loopback by default unless the operator explicitly opts into network exposure;
- document TLS termination and a trusted-proxy model, and set the session cookie `Secure` based on the externally observed HTTPS deployment rather than a disconnected boolean;
- add a deployment smoke test proving startup fails with missing, placeholder, short, or duplicate secrets.

This expands H3: the test/dev credentials are a repository hygiene issue; the Compose values are production-path defaults.

#### S6 — High — request, response, persistence, and scheduled-work limits are inconsistent or absent

No Hono body-limit middleware is installed. Most routes call `req.json()`, `formData()`, or `parseBody()` without endpoint-specific byte limits. Several remote fetchers in S3 have a timeout but no response-size cap. The webhook event validator caps only `title`; `description`, `metadata`, category count/length, and total payload remain unbounded (`webhook-feed.utility.ts:25-49`). Each accepted event reads the complete JSONL history into memory and rewrites the entire file (`:72-89`), and no retention is applied there before persistence. Sitemap/Calendar limits are applied only after full download and parse.

User-provided regexes are executed without a safe-regex check or runtime limit in `feed-item-filter.utility.ts:54` and `sitemap.utility.ts:77`. Because these run over remote items on a schedule, a pathological expression/input pair can repeatedly monopolize the event loop.

Required fix:

1. Add a conservative global body cap plus smaller per-route limits; return `413` before parsing.
2. Stream or hard-cap every remote response, decompressed bytes included, before DOM/XML/JSON parsing.
3. Bound webhook fields, arrays, nesting depth, event count, file size, and request rate; append atomically rather than read/rewrite the entire history, and enforce retention during ingestion.
4. Add per-feed concurrency limits, queue backpressure, cancellation, and a total run budget that covers browser work and parsing—not only socket timeout.
5. Replace arbitrary backtracking regex with a safe engine/restricted syntax, or reject unsafe patterns and evaluate in an interruptible worker with strict time/memory limits.

#### S7 — High (expands B4) — vulnerable dependencies are reachable on sensitive paths

The live counts match B4, but the security pass established direct reachability for the most important packages:

- `xmldom@0.6.0` parses fetched, attacker-controlled RSS/Atom XML at `existing-feed-parser.utility.ts:81`. The legacy `xmldom` package has no patched release for the critical multiple-root advisory; migrate to maintained `@xmldom/xmldom` and reject malformed/multi-root input. [GHSA-crh6-fp67-6883](https://github.com/advisories/GHSA-crh6-fp67-6883)
- `hono@4.12.18` is below the `4.12.25` Windows `serve-static` fix. mkfd uses Bun's `serveStatic` for both `/public/*` and the auth-protected `/configs/*` on a Windows-supported host. The advisory does not permit root escape, but it can bypass prefix-mounted protection; add a regression test for encoded backslashes and upgrade. [GHSA-wwfh-h76j-fc44](https://github.com/advisories/GHSA-wwfh-h76j-fc44)
- `axios@1.16.1` is below `1.18.0` and is the application's network core, including requests with protected headers and proxy profiles. Upgrade and retest proxy/redirect behavior. [GHSA-gcfj-64vw-6mp9](https://github.com/advisories/GHSA-gcfj-64vw-6mp9)
- `js-yaml@4.1.1` loads every persisted feed config and catalog recipe; current audit data includes two High 2026 algorithmic-complexity advisories. Upgrade to a fixed release and cap YAML size/complexity. [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)

Not every advisory in the raw counts is reachable in production (several front-end findings affect dev-server, build, RSC, or unused modes), so the correct gate is: upgrade direct dependencies, regenerate the lockfile, rerun tests/build/e2e, produce an advisory-by-advisory reachability record, and allow only documented, time-bounded exceptions. Do not treat a lower raw count alone as proof of remediation.

#### S8 — Medium — A2 also enables browser-to-localhost CSRF, independent of cookies

A2 focuses on reverse proxies and indeterminate addresses, but `isLocal` creates another attack path. A malicious website opened on the operator's machine can submit simple cross-origin form requests to `http://127.0.0.1:5000` or `http://localhost:5000`. mkfd sees the browser's connection as loopback and skips authentication; the browser does not need to send a session cookie. CORS prevents reading many responses, but it does not prevent write-only HTML form submissions. mkfd accepts URL-encoded/multipart creation at `POST /` and has legacy state-changing form routes such as `POST /delete-feed`.

Required fix: remove implicit loopback authorization entirely. Require the same authenticated session for local and remote traffic; enforce `Origin`/`Sec-Fetch-Site` on browser state changes and a CSRF token where form posts remain; require JSON/custom headers for API mutations; and test requests from an unrelated origin to localhost. `SameSite=Lax` is helpful but cannot protect a route that bypasses authentication before checking the cookie. See [OWASP CSRF](https://owasp.org/www-community/attacks/csrf).

#### S9 — Medium — incoming webhook security is internally contradictory and leaks tokens into URLs

`POST /webhook-feeds/:slug` implements a good 256-bit random token, SHA-256 storage, length check, and `timingSafeEqual` (`webhook-feed.utility.ts:9-23`). However, the global auth middleware protects the route, so a normal external webhook sender must possess both the webhook bearer token and a browser session; in practice it works remotely only when A2 has already failed open. If this path is later excluded from session auth, S6's missing body/rate/storage limits immediately become internet-facing.

The route also accepts `?token=` (`routes/webhook.ts:13`), exposing credentials to access logs, copied URLs, monitoring, and intermediary metadata. Accept `Authorization: Bearer` only, return generic failures, make slugs unique, apply constant-time verification, body/rate limits, replay/deduplication policy, and explicitly exempt **only this exact route** from session auth after those controls exist.

#### S10 — Medium — the container/build path lacks basic least-privilege and reproducibility controls

The Dockerfile never changes `USER`, so the web app, browser, parsers, and mounted config/extension directories run as root. It downloads a Node tarball through `curl | tar` without verifying a checksum/signature, runs `bun install` without a frozen lockfile, invokes `bunx patchright` during the build, and uses an old tag-only Bun base. Compose runs `tbosk/mkfd:latest`, making the deployed artifact mutable by tag.

Required fix: use a multi-stage build; pin reviewed base/runtime artifacts (prefer a digest in release automation); verify the Node archive checksum; install from a frozen lockfile; avoid network-resolved build tools outside the lock; run as a dedicated numeric UID/GID with only data/config paths writable; drop capabilities, enable `no-new-privileges`, and support a read-only root filesystem. Generate an SBOM, scan the final image, and sign/provenance-attest release images. Docker's own guidance says to use `USER` when a service can run without privileges: [Docker build best practices](https://docs.docker.com/build/building/best-practices/).

#### S11 — Medium — errors and network diagnostics can disclose sensitive request context

`utilities/webhook.utility.ts:140-183` logs complete remote response bodies and, on no-response failures, the Axios request object after merging user-configured headers. `routes/preview.ts:67-79` likewise logs remote response/request data and reflects a serialized upstream response body to the authenticated client. URLs are logged in several fetch paths; credentials embedded in a URL would therefore be exposed. These values can contain bearer headers, webhook payload data, proxy authentication, internal service details, or attacker-controlled terminal/log content.

Required fix: route all diagnostics through structured logging with an allowlist of safe fields; recursively redact authorization/cookie/token/password/proxy fields and URL userinfo/query secrets; cap and encode untrusted strings; never log raw request objects or full upstream bodies; attach an opaque correlation ID and keep detailed diagnostics behind an explicit local debug mode.

### 8.3 Security controls worth preserving

The audit also confirmed several sound controls that should survive the remediation:

- `assertSafeFeedId` uses a strict identifier allowlist, and feed-config CRUD consistently uses it on the newer API routes.
- Filesystem feeds lexically confine the configured root and skip entries identified as symlinks; retain this and strengthen it with `realpath`/handle-based checks against junctions and TOCTOU.
- Standard Axios GET handling disables automatic redirects and revalidates each hop.
- Webhook tokens are generated with 32 random bytes and compared with `timingSafeEqual` after a length check.
- Protected values are recursively masked before normal config responses, and the service-connector validator rejects plaintext auth values.
- Session cookies are `HttpOnly` and `SameSite=Lax`; `Secure` is available when `SSL` is configured. Preserve those flags while fixing the trust/proxy model.
- The tracked-file pattern scan found published test/dev constants and Compose placeholders already described in H3/S5, but no additional production-looking high-entropy credential. This was a targeted pattern review, not a substitute for automated full-history secret scanning in CI.

### 8.4 Revised security release gate

Security work should precede the earlier front-end release plan in this order:

1. **Containment:** fix A1 and A2; remove loopback authorization; stop emitting/passing the encryption key through arguments/output; require real deployment secrets; keep the service bound to loopback until these ship.
2. **Network boundary:** replace direct network calls with one policy-enforcing executor; close DNS TOCTOU; cover POST/webhook/browser/FlareSolverr/drill/connector paths; connect the Settings values to enforcement.
3. **Dependency gate:** replace `xmldom`, upgrade Hono/Axios/`js-yaml` and the front-end tree, lock deterministically, and document reachability/exceptions.
4. **Secret migration:** deploy versioned AEAD, migrate existing protected values, provide rotation/recovery, and add tamper tests.
5. **Availability controls:** body/response/decompression limits, webhook retention and rate limiting, queue/concurrency budgets, regex restrictions, and cancellation.
6. **Web hardening:** login throttling with timing-safe verification, CSRF/origin checks, a deliberate webhook auth exception, security headers/CSP, and removal of raw `/configs/*` static serving. OWASP recommends login throttling as a primary automated-attack control: [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
7. **Runtime hardening:** non-root immutable container, restricted writable mounts and egress, verified/pinned build inputs, SBOM/image scan/signing, and safe structured logs.
8. **Security CI:** dependency audit with policy, full-history secret scan, SAST, container/IaC scan, and integration tests enumerating every auth and network sink. Fail the build when a new direct network primitive or unguarded state-changing route appears.

### 8.5 Revised security conclusion

The backend decomposition and several individual controls are good, but the application is **not following security best practices consistently enough for network exposure**. The most important systemic issue is not the absence of an SSRF helper; it is that security-sensitive operations can bypass the helper, and the UI-configured policy is not the policy the runtime enforces. The same pattern appears in secret handling: values are masked in API responses, yet the master key is sent in process arguments/output and protected data uses unauthenticated encryption.

Until A1/A2, S1-S5, and the reachable portion of S7 are fixed and regression-tested, treat mkfd as a trusted-local-development application only: bind it to loopback, do not expose it through a reverse proxy, do not rely on the Compose placeholder defaults, avoid running it with cloud metadata/internal-service reachability, and rotate any encryption key that may have entered collected process output.
