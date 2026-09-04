# Feature Ship-Readiness Review — `major-revision-0526`

**Review date:** 2026-09-02  
**Reviewed commit:** `c8a54df`  
**Scope:** all feature entries in [`docs/superpowers/PROGRESS.md`](superpowers/PROGRESS.md), checked against the implementation, automated tests, build output, and the consolidated code/security findings in [`mkfd-audit-aggregate-0526.md`](../mkfd-audit-aggregate-0526.md).

## Executive decision

**Do not ship this branch as a production release yet.**

The progress tracker marks every feature as implemented, but the code does not meet the documented acceptance criteria for most of them. Of the 31 feature rows in `PROGRESS.md`:

| Verdict | Count | Meaning |
|---|---:|---|
| **Ready** | 3 | The documented feature scope is materially implemented and covered by useful automated checks. |
| **Conditionally ready** | 2 | The feature's core implementation is credible, but a named verification or integration gate is still open. |
| **Additional work required** | 24 | One or more material acceptance criteria, security controls, or usable end-to-end paths are missing or broken. |
| **Not independently auditable** | 2 | `PROGRESS.md` says implemented, but no corresponding spec or implementation plan exists. |

The three Ready verdicts do **not** make the application releasable. Two application-wide critical security defects, vulnerable runtime dependencies, a broken Source Assistant apply path, a nonfunctional mobile builder, unsafe draft persistence, and incomplete production quality gates remain release blockers. See the aggregate audit for the full severity register.

## Evidence and review rules

This review treated the 31 rows in `PROGRESS.md` as the canonical feature inventory. The 29 design specs describe expected behavior; the 29 implementation plans provide the intended completion checks. Files under `docs/features/` and the release overview were used as supporting roadmap evidence rather than counted as separate features.

Verification at the reviewed commit:

| Check | Result |
|---|---|
| Backend test suite, `bun test tests/` | **Pass:** 438 tests, 724 assertions, 0 failures across 37 files. |
| Community catalog validation, `bun run validate:catalog` | **Pass:** 1 catalog feed validated. |
| Production frontend build, `bun run build` | **Pass with warning:** 943.22 kB JavaScript / 281.61 kB gzip in one chunk; Vite warns that the chunk exceeds 500 kB. |
| Browser tests | The existing five desktop-only Playwright specs contain 12 cases and passed when servers were started manually during the combined audit. The checked-in runner is still broken on Windows because it uses POSIX inline environment assignment. |
| Dependency audit | Existing audit evidence at this commit records 58 root findings (1 critical, 18 high) and 15 frontend findings (8 high). Runtime-relevant packages include `xmldom`, Hono, Axios, and `js-yaml`. |
| Plan completion records | **1,077 unchecked tasks; 0 checked tasks** across the 29 implementation plans. This conflicts with the all-green implementation column in `PROGRESS.md`. |

A passing build or unit test was not treated as proof of ship readiness when the documented workflow was absent from the UI, bypassed its security policy, or lacked an end-to-end path. “Ready” below means the individual feature appears ready in isolation; production release still requires the cross-cutting gates at the end of this report.

## Feature-by-feature findings

### Phase 1 — foundation

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Protected Value Encryption | **Additional work required** | The `ProtectedValue` model, environment-backed values, masking/preservation, and unit coverage exist. The protected-value implementation uses unauthenticated AES-CBC, however, and the email-worker launch path passes the master key in command arguments and prints the child command, exposing the key through process inspection and logs. Replace AES-CBC with an authenticated construction such as AES-GCM, version ciphertexts and migrate existing values, pass the key through a non-argv secret channel, remove secret-bearing command logging, and add tamper/migration/process-boundary tests. |
| Feed Config Formalization | **Additional work required** | The discriminated union, normalizer, caster, validator, route adapter, and worker normalization exist with good unit coverage. The documented frontend converter is effectively a no-op cast (`frontend/src/lib/feed-config-builder.ts`), and the builder initializes and submits fields for every source type instead of emitting only the selected type's shape. Finish a real per-type frontend converter, remove irrelevant defaults, make sensitive-field handling exhaustive, and add create/edit/preview round-trip tests for every feed type. |
| SQLite Runtime Substrate + Feed History | **Conditionally ready** | A single Drizzle-backed runtime DB, feed-history tables, startup and lazy migration, file fallback, and migration/store tests are present. Before release, run and record the plan's real-data startup/lazy-migration smoke test, confirm backup/restore and DB-init failure behavior, and reconcile/document the two settings tables (`settings` and `app_settings`) plus the unused `runtime_migrations` model so operators have one authoritative schema story. |
| Outbound Fetch Policy | **Additional work required** | The policy correctly rejects many private/metadata destinations, validates redirects, and has focused tests. It is not the single outbound boundary required by the spec: several URL-fetching paths still call network clients directly, DNS rebinding protection is incomplete, per-request address pinning is absent, and overrides are not consistently auditable. Route every user-controlled network sink—including GraphQL, connectors, transformer bodies, JSON-LD drill-down, FlareSolverr, webhooks, and proxy/profile paths—through one resolver-aware policy; validate every redirect; default-deny private/link-local/metadata ranges; and add sink-by-sink SSRF integration tests. |

### Phase 2 — shared pipeline and application redesign

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Feed Format Refactor | **Ready** | RSS 2.0, Atom, and JSON Feed serializers are centralized in `utilities/feed-output.utility.ts`; the main and email workers write all formats; preview supports format selection; paths use safe feed IDs; and format/history tests pass. Retain this verdict by adding these format checks to the required CI gate. |
| Normalized Feed Item Pipeline | **Ready** | The canonical normalized-item model and shared builder exist, deterministic GUID/title/date/enclosure/category behavior is tested, and the transformer plus new source workers consume the shared output path. Legacy scraper/API internals remain older implementations but do not create a second new-source model, which is consistent with this feature's stated boundary. |
| Email Worker Multi-Format + History | **Additional work required** | The worker now emits all formats and stores normalized snapshots. It is blocked by master-key exposure at its process boundary and command logging. Redesign worker secret delivery, verify restart/deduplication against SQLite with a live IMAP fixture, and add an end-to-end test proving no credential or key appears in logs, process arguments, generated feeds, or API responses. |
| Auto-save Draft | **Additional work required** | Draft save/restore/clear behavior exists, but redaction is a fragile denylist and currently persists `webhookToken`, `webhookTokenHash`, `serviceConnectorApiKey`, and form-submission fields to `localStorage`. Replace it with an explicit safe-field allowlist (or store no source credentials at all), version/migrate or purge unsafe existing drafts, and add regression tests for every current and future protected field. |
| App Shell / Navigation Redesign | **Additional work required** | The desktop shell, sidebar, route layout, and mobile bottom navigation exist. Below the `lg` breakpoint the sidebar disappears while the bottom navigation omits Health and Settings, making those routes undiscoverable on phones and portrait tablets. Add complete small-screen navigation, current-route semantics, keyboard/focus tests, route-level titles, a skip link, and responsive browser coverage. |
| My Feeds Redesign | **Additional work required** | Search, filters, views, cards/table, detail drawer, and optimistic actions are present. Delete Undo restores only client state after the server deletion; the portal action menu may unmount before item clicks fire; failed mutations can still look successful; toast identity causes repeated feed refetches; and the drawer lacks dialog/focus behavior. Implement real soft-delete/restore or confirmation-only deletion, fix portal event handling, centralize checked mutations with rollback, memoize toast context, use an accessible dialog primitive, and add keyboard/mobile/e2e mutation tests. |
| Builder UI Redesign | **Additional work required** | The workbench layout and type picker exist, but at 390 px the fixed-width preview collapses the form to roughly 49 px. The header action can double-submit, the preview fabricates hard-coded sample XML, six new source types inherit irrelevant scraping steps, and configuration serialization is a no-op cast. Make the layout responsive, use real/clearly labelled preview state, define source-specific steps, share submission state, filter payloads by type, and add 390 px plus one full create/preview/save flow per source type. |
| UI Redesign Correction Pass | **Not independently auditable** | This row is marked Spec/Plan/Impl complete, but there is no matching design spec or plan among the 29 document pairs. Create a scoped correction spec with measurable visual, accessibility, responsive, and regression acceptance criteria; map the resulting commits/tests; then re-review it. Existing UI findings show the branch cannot receive a Ready verdict by inference. |
| Workbench v2 Frontend Redesign | **Not independently auditable** | This row is also marked fully complete without a matching spec or plan. Add the missing artifact defining what distinguishes Workbench v2, its supported breakpoints and workflows, and its accessibility/performance bar. The current mobile collapse, fabricated preview, dead workbench props/components, token drift, and missing frontend quality gate must be resolved before this can be assessed as shipped. |

### Phase 2.5 — administration

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Settings Page (Runtime/Admin) | **Additional work required** | The page, API, persisted app settings, masking, and settings tests exist. Several saved outbound-policy values are not consumed by the runtime, so the UI can report a successful change that does not change behavior; Health/Settings are also absent from small-screen navigation. Establish one typed settings registry, wire each setting to its runtime consumer, distinguish restart-required values, remove duplicate settings storage, test authorization/masking, and add a save→restart→behavior integration test for every setting. |

### Phase 3 prerequisite — backend structure

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Backend Route Decomposition | **Conditionally ready** | The monolithic route surface has been split into focused routers and route-adapter tests pass. The plan's manual parity checklist remains entirely unchecked, all routers are still mounted at `/`, and application-wide middleware/static-serving risks remain concentrated in `index.ts`. Execute and record every parity smoke case, add route/middleware integration tests, and verify auth plus static exposure before declaring the refactor release-ready. |

### Phase 3 — intelligence and fetch capabilities

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Existing Feed Transformer | **Additional work required** | Fetch, RSS/Atom parsing, transforms, normalized output, preview, and worker dispatch exist. It parses attacker-controlled XML using vulnerable, abandoned `xmldom@0.6.0`; user-controlled request details can escape the intended shared policy; and there is no full create→preview→worker test. Replace the parser, enforce the single outbound policy on every request field and redirect, set input/response/parser limits, and add hostile-XML plus end-to-end transformation tests. |
| Source Assistant: Backend Core | **Additional work required** | Analyze/apply routes, observations, recommendation models, scorers, and starter configuration code exist. Much of the adapter layer is one-line aliases; scorers are brittle hard-coded heuristics (the service-connector scorer always returns `null`); calendar detection has false-positive/false-negative logic; and fallback starter configs use fields/types the forms do not accept. Implement real route-specific adapters and evidence-based scoring, return form-valid starter data for every route, enforce time/body/redirect limits, surface partial failures, and add golden analyze/apply tests for all supported source types. |
| Source Assistant: Frontend | **Additional work required** | The panel, recommendations, manual fallback, and apply navigation exist. Calendar is routed to the email builder; sitemap, GraphQL, service connector, and change detection fall back to web scraping; returned starter field names do not hydrate their forms; progress is simulated; and request errors are swallowed. Use one exhaustive route/type registry, validate starter payloads, replace fake stages with honest indeterminate or server-backed progress, show actionable errors/cancellation, and add one browser apply-flow test per recommendation type. |
| JSON-LD Integration | **Additional work required** | JSON-LD extraction and normalization utilities have basic tests and a minimal web-scraping mapping UI exists. The documented page/drill workflow, candidate/path selection, Source Assistant handoff, configurable single run budget, and robust end-to-end preview/worker behavior are incomplete; drill URLs also need unified SSRF enforcement. Build the candidate-selection/drill UI, budget the entire chained run, apply the outbound policy at each hop, handle malformed/large JSON-LD safely, and test page-only plus drill-through flows end to end. |
| Web Scraping Form Data | **Additional work required** | Runtime support for GET and POST with URL-encoded/JSON bodies exists. The builder exposes only one fixed field with no add/remove or protected-value editor; Source Assistant hydration is broken; multipart is accepted by the model but not correctly executed; and draft redaction can persist submitted secrets. Complete the field editor and encodings (or reject unsupported multipart), integrate protected values/masking, make assistant/preview/worker use the identical request builder, enforce limits and SSRF policy, and add credential-leak plus method/encoding integration tests. |
| Fetch Policy / Retry / Fallback | **Additional work required** | Timeout, retry, response-size, and attempt metadata primitives exist. The documented policy modes and fallback behavior are not fully executed, Settings values do not consistently drive runtime behavior, and different source paths bypass the utility. Implement the fallback state machine, define which failures are retryable, enforce one total time budget, bind persisted settings and per-feed overrides, record sanitized attempt metadata, and exercise standard/retry/fallback/redirect cases for every source family. |
| Proxy / User-Agent Profiles | **Additional work required** | Profile API/UI scaffolding and runtime lookup exist, but profiles are process-memory state and disappear on restart; the UI can add user agents but does not provide complete proxy CRUD; builder fields are raw IDs; and only the standard web-scraping fetcher consistently resolves profiles. Persist and encrypt profiles, complete authorized CRUD and reference pickers, validate/test connections without leaking credentials, use profiles across all documented fetchers, and add restart plus unavailable-profile tests. |

### Phase 4 — sharing and community

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Parameterized Feed Config Templates | **Additional work required** | Template interpolation, typed parameters, protected-value handling, catalog import, and unit tests exist. The documented general manual YAML import path/UI is absent, secret storage can still be selected as plain text, and there is no complete parameterize→validate→preview→save browser flow. Add safe manual import, prohibit or strongly gate plaintext secrets, validate parameter constraints before preview/write, preserve masked values on edit, and add malicious-template/path/secret tests plus end-to-end coverage. |
| Community Catalog | **Additional work required** | A manifest, sample config, validation script/workflow, browse UI, preview/import APIs, and local cache exist. The client reads only repository-local files; it does not fetch a remote manifest or implement the documented last-known-good disk cache/fallback. Implement signed or integrity-checked remote retrieval, bounded caching and offline fallback, source attribution/version compatibility, safe update semantics, sanitized preview/import tests, and a multi-entry catalog test rather than relying on one sample. |
| Service Connector GitHub Issue Template | **Ready** | The structured issue form exists with connector-specific discovery/auth/privacy/testing questions, no-secret guidance, required acknowledgements, and the expected labels. `CONTRIBUTING.md`, the review checklist, and the connector design template link the triage workflow. Repository-host settings should still be checked once after merge to ensure issue forms and labels are enabled. |

### Phase 5 — new source types

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Sitemap | **Additional work required** | Models, validation, XML parsing, normalized items, preview/worker dispatch, and a basic URL/limit form exist. Sitemap-index children are detected but not traversed; discovery mode, page metadata/JSON-LD enrichment, fallback extraction, durable first-seen state, filtering controls, warnings, and Source Assistant recommendation/application are incomplete. Implement bounded recursive traversal and discovery, persist state in SQLite, expose documented filters/strategies, reuse the shared fetch policy at every child URL, and add urlset/index/gzip/partial-failure/e2e tests. |
| Calendar | **Additional work required** | Models, validation, normalized output, preview/worker dispatch, and a minimal form exist. The hand-written ICS parser does not robustly handle folded lines, escapes, `TZID`, recurrence rules/exceptions, or cancellations; recurrence expansion is not integrated; filters are missing; and Source Assistant routes calendar to email. Adopt a maintained calendar parser, implement timezone-safe bounded recurrence/exception expansion with stable GUIDs, exclude cancellations, expose filters, fix assistant routing, and add DST/recurrence/malformed/live-flow tests. |
| GraphQL | **Additional work required** | Query execution, basic response mapping, validation, normalized output, preview/worker dispatch, and a minimal form exist. Variables, operation name, protected headers, array-path discovery/selection, full field mapping, partial `errors` warnings, and policy-consistent fetching are not complete in the UI/runtime path. Finish the builder and Run Query workflow, preserve GraphQL data-with-errors as a warning, fail errors-without-data, enforce SSRF/size/time limits, and add authenticated/multi-operation/paginated/e2e tests. |
| Webhook | **Additional work required** | Token generation/hashing, payload normalization, dedupe, append storage, immediate feed regeneration, and an ingestion route exist. A generated token is not reliably returned once to the creator, the endpoint sits behind application session middleware, query-string tokens are accepted, there is no rate/body-size limit, persistence is JSONL rather than the roadmap's SQLite substrate, startup rebuild is absent, and the builder presents a relative curl example. Make the ingestion endpoint independently bearer-authenticated, show a generated token exactly once, remove query-token auth, hash/compare safely, enforce rate/body/retention limits, persist/rebuild transactionally, produce an externally valid URL, and add restart/concurrency/auth tests. |
| Filesystem | **Additional work required** | Root-bound path resolution, globbing, symlink avoidance, sidecar metadata, normalized output, preview/worker dispatch, and tests exist. Root authorization is not fully validated at save time; configured-root discovery/selection is minimal; state remains JSON files rather than the roadmap's runtime DB; the optional safe file-serving route is absent; and the builder exposes only a subset of documented mapping controls. Validate canonical paths on save and run, persist state in SQLite, complete root/pattern/mapping UI, define file-link behavior explicitly, test symlink/junction/TOCTOU cases on supported platforms, and add a real-directory end-to-end test. |

### Phase 6 — first-class integrations

| Feature | Verdict | Evidence and additional work |
|---|---|---|
| Service Connectors | **Additional work required** | A Jellyfin definition/adapter, protected API-key model, validation, runtime fetch, state table, normalized output, and focused tests exist. The UI is primarily raw text fields and does not perform definition listing, connection test, resource discovery, or preview flows; connector requests bypass the common outbound policy; state uses ad-hoc SQL; private-by-default output is not enforced; and no complete Jellyfin create→test→discover→preview→save→worker scenario is tested. Implement the documented connector UX and route sequence, enforce protected credentials and private defaults, use the shared policy/profiles, move state into managed Drizzle migrations, prove catalog exclusion, and add a mocked Jellyfin end-to-end test with restart/deduplication and leak checks. |

## Cross-cutting release gates

Even after completing the feature-specific work above, the branch should not ship until all of these gates are green:

1. **Close the two critical application security findings.** Isolate or remove same-origin scripting from the remote-content proxy, and replace the fail-open/local-address authentication bypass with explicit, default-deny trust configuration.
2. **Fix secret handling.** Eliminate draft leakage, master-key argv/log exposure, plaintext production defaults, public config serving, timing-unsafe comparisons, and unmasked logs/responses. Complete a secret-flow regression suite.
3. **Make outbound safety universal.** Inventory every URL sink and prove that one DNS/redirect-aware SSRF policy, bounded response handling, and auditable overrides cover all of them.
4. **Remediate dependencies.** Upgrade Hono, Axios, `js-yaml`, and transitive packages; replace `xmldom`; then require a clean or explicitly risk-accepted dependency audit in CI.
5. **Restore credible frontend gates.** Include `frontend/` in linting, add a deterministic root/frontend typecheck, fix the cross-platform Playwright startup command, and run desktop plus 390 px mobile browser suites with accessibility checks.
6. **Exercise real workflows.** Add source-type-specific create/edit/preview/save/worker/output tests. The current browser suite covers shell-level behavior, not the new features' acceptance criteria.
7. **Close UI/UX blockers.** Fix mobile builder/navigation, real mutation error handling, delete semantics, assistant routing, accessible dialogs/toasts/forms, default contrast, error boundaries, and the fabricated preview.
8. **Reconcile documentation truth.** Add specs/plans for the two undocumented redesign rows, check off plan tasks only with linked evidence, and update `PROGRESS.md` to reflect actual readiness rather than file presence.

## Recommended release sequence

1. Security and dependency remediation.
2. Quality-gate repair and end-to-end test harness stabilization.
3. Foundation fixes: config serialization, settings enforcement, universal outbound policy.
4. Builder, Source Assistant, and responsive/accessibility corrections.
5. Complete and verify each Phase 5 source independently.
6. Finish templates/catalog remote behavior and the full Jellyfin connector workflow.
7. Re-run the full audit, dependency scan, mobile/accessibility suite, and documented manual smoke checks; only then change feature statuses to Ready.

