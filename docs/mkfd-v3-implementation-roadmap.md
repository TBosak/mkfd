# Mkfd v3 Implementation Roadmap

**Drafted:** 2026-09-02

**Target branch:** `major-revision-0526` at review baseline `c8a54df`
**Inputs:** [`feature-ship-readiness-review-major-revision-0526.md`](feature-ship-readiness-review-major-revision-0526.md) and [`mkfd-audit-aggregate-0526.md`](../mkfd-audit-aggregate-0526.md)

## Goal

Complete the major revision as a secure, supportable Mkfd v3 release without repeatedly reopening the same architecture or code surfaces. The roadmap groups work by shared implementation context rather than by audit severity or the order in which findings were discovered.

The release is complete when all 31 documented features have a supported disposition, every v3-scoped feature meets its acceptance criteria through a real create-to-output path, all critical/high security gates are closed or explicitly risk-accepted, and the release can be reproduced by CI on supported platforms.

## Planning principles

1. **Fix shared boundaries before features.** Authentication, secrets, outbound networking, settings, limits, config serialization, and test harnesses are prerequisites—not cleanup after source implementation.
2. **Give each high-churn surface one primary owner.** App shell/My Feeds, builder/forms, Source Assistant/web intelligence, and runtime/network infrastructure are separate packets. Avoid concurrent edits to their shared files.
3. **Finish vertically inside each packet.** Implementation, migration, tests, documentation, and deletion of superseded code happen together. Do not create later “test,” “accessibility,” or “cleanup” passes for work that can be completed while context is loaded.
4. **Freeze contracts before parallel work.** Source agents start only after the feed-config schema, outbound executor, settings registry, protected-value API, source registry, and builder form contract are stable.
5. **Prefer the smallest honest v3 behavior.** An indeterminate progress indicator is preferable to building progress streaming solely for visual effect; confirmation-only deletion is preferable to fake Undo; unsupported capabilities should be hidden rather than rendered as working.
6. **Evidence updates status.** `PROGRESS.md` changes only when the matching automated checks and any required smoke evidence are linked. File presence is not completion.
7. **Use separated-role TDD for every implementation slice.** Codex writes the requirements brief and scrutinizes tests; Claude Code Sonnet 5 alone writes and revises tests; Codex returns deficient tests to Claude without editing them, locks accepted tests, implements production code, and proves GREEN without changing the accepted suite. `AGENTS.md` and `docs/agent-workflow/TDD.md` are the authoritative operating procedure.

## Release policy

No package should be merged with knowingly failing tests in its owned area. The branch may remain temporarily red only while Packet 1 establishes the baseline and must be green at every packet boundary thereafter.

Minimum v3 release gates:

- zero known exploitable Critical or High vulnerabilities in shipped/reachable dependencies, unless an explicit written exception documents reachability and mitigation;
- no authentication or secret-handling Critical/High findings open;
- one policy-enforcing boundary for every outbound HTTP(S) operation;
- zero frontend/backend lint or typecheck errors;
- unit, integration, desktop browser, 390 px mobile, and automated accessibility checks passing;
- clean-install build and test from the lockfile on Windows and Linux/Docker;
- every shipped source type passes create, edit, preview, save, scheduled/triggered run, output-format, failure, and secret-leak checks;
- representative v2 web-scraping, REST API, and email configs survive load→edit-without-change→save with no semantic change except an explicit schema/encryption migration;
- Selector Playground and explicitly configured FlareSolverr flows pass functional parity and security-isolation tests; neither may be removed or silently disabled to close a security finding.

## Locked product decisions

These decisions supersede the earlier provisional recommendations and are requirements for v3:

1. **Selector Playground remains a supported v3 feature.** Preserve all 16 v2 selector destinations. Replace the unsafe same-origin proxy with an isolated playground document: strip target scripts and active content, self-host and integrity-pin the selector tool, use a restrictive CSP, run the iframe without `allow-same-origin`, forms, popups, or modals, and accept messages only from the exact iframe window with a per-session nonce and a schema-validated selector payload. The target URL and every redirect still pass the shared outbound policy. A genuinely separate cookieless origin is an acceptable stronger deployment variant, but is not required if the opaque-origin sandbox design passes the threat tests.
2. **FlareSolverr remains a supported v3 feature.** Preserve explicit per-feed opt-in, connection health, preview, worker, drill-chain, selector-suggestion, and Selector Playground use. Route it through one hardened adapter, validate both the FlareSolverr endpoint and requested destination, bound sessions/time/response size, redact configuration, and document that the FlareSolverr service itself must run with restricted egress. Do not introduce automatic fallback to FlareSolverr unless the user explicitly configures it.
3. **Compatibility takes precedence over cleanup.** A v2 capability or stored field with a clear use case is restored or migrated, not deleted merely because its v3 path is incomplete. Any intentional removal requires a named product decision and release-note entry.
4. **The Mkfd repository is the authoritative Community Catalog.** Catalog recipes and their manifest entries live under `community-catalog/`, enter through reviewed pull requests, and are validated by the catalog CI workflow. Running instances fetch the merged `main` catalog from `https://tbosak.github.io/mkfd/community-catalog/manifest.json`, fall back to `https://raw.githubusercontent.com/TBosak/mkfd/main/community-catalog/manifest.json`, and retain a last-known-good local cache. The downloadable bundle plus manual pull request is the MVP submission path; an automated GitHub App broker remains optional post-MVP work, not a prerequisite or a separate catalog authority.

## v2→v3 functionality-preservation audit

**Baseline:** `main` at `6977d5251450f966855924a77066c19b6bf783c0` (Mkfd 2.1.2) compared with `major-revision-0526` at `c8a54df`. The audit compared the three v2 builder types, request-to-YAML casting, runtime consumers, My Feeds actions, utility routes, worker behavior, CLI/environment/deployment inputs, and documented v2 features.

### Regressions and compatibility risks

| ID | Priority | Finding and evidence | Required disposition | Packet |
|---|---|---|---|---:|
| V2-01 | Release blocker | Web-scraping edit/save is destructive. `configToFormData` reconstructs field `drillChain`, `iterator`, and GUID permalink state, but `buildCSSTargetFromForm` drops all three. Parallel iterators and per-field drill chains are documented v2 features and remain supported by the RSS runtime. | Preserve every `CSSTarget` property through normalization and form round trips; cover every article field, iterator, nested drill step, date override, and GUID semantics with golden v2 fixtures. | 3, 5 |
| V2-02 | Release blocker | Common headers are corrupted on edit: the converter emits `[{key,value}]`, while the caster treats that array as a record and can write keys such as `"0"` instead of the actual header name. The new protected-value editors also flatten protected/env values back to strings. | Adopt one rich key/value wire shape for common/API/form/GraphQL headers and bodies. Preserve protected/env/plain variants and masked ciphertext on edit. | 2, 3, 5 |
| V2-03 | Release blocker | Outbound webhook notifications cannot be enabled from the current builder. The v2 `Enable Webhook Notifications` control was removed, while the caster only emits a webhook when `webhook.enabled` is true. | Restore an explicit enable control and gate/validate its settings. Test create, disable, re-enable, edit, automatic delivery, and manual delivery. | 5 |
| V2-04 | Release blocker | Webhook `headers` and `customPayload` are read into the form but omitted by the caster. The email child-process message also carries only enabled/URL/format/new-items-only. Editing or running a v2 webhook can therefore discard or ignore customization. | Preserve and protect custom headers/payload through browser→config→worker; validate JSON/templates and apply the same outbound policy/redaction to every delivery path. | 2, 3, 7B |
| V2-05 | High | The v2 My Feeds page exposed **Trigger Webhook**. The backend `/trigger-webhook` route still exists, but the v3 action menu has no action for it. | Restore the action with loading, success/failure feedback, authorization/CSRF, and a disabled/explanatory state when the feed has no outbound webhook. | 4 |
| V2-06 | High | Web feed-level RSS metadata is lost or reset on edit. The converter reconstructs selector-backed language, copyright, managing editor, webmaster, categories, TTL, skip hours/days, and image values, but the caster reads different flat fields or defaults. Hand-authored `feedDocs`, `feedGenerator`, description, and related supported metadata are also not preserved. | Define canonical metadata fields and lossless legacy aliases. Preserve unedited values even when a field is not exposed; add UI only where users need to modify it. | 3, 5 |
| V2-07 | High | v2 inferred relative-link/base-URL behavior for link, enclosure, and source URL from fetched sample HTML. v3 still fetches `sampleHtml` during create/update but never passes it to the caster; the new CSS-target builder containing inference logic is disconnected. | Make create, edit, preview, and worker use one CSS-target builder and one explicit-vs-inferred rule. Add relative, absolute, redirect, and malformed-link fixtures. | 3, 6 |
| V2-08 | High | The v2 **Suggest Selectors** URL→suggest→apply workflow was removed from the web form even though `/utils/suggest-selectors` remains. The partial Source Assistant apply path omits attributes, link base/relative settings, and enclosure, and currently depends on other broken recommendation routing. | Restore the direct workflow as a lightweight action and share its complete typed apply adapter with Source Assistant. Apply iterator, selectors, attributes, relative/base URL, enclosure, date, and author atomically with review/undo. | 6 |
| V2-09 | High | Email feeds lost access to v2 common controls. Their section registry has no `output` step, but reverse, strict, and outbound webhook controls render only in `output`. New email feeds cannot configure them and existing values cannot be reviewed. | Give email a deliberate Output/Delivery step containing applicable v2 controls; preserve hidden values and clearly label unsupported preview behavior rather than silently omitting settings. | 5, 7B |
| V2-16 | High | REST API feeds lost the v2 cookie input. The old shared options rendered cookies for API feeds, while the v3 shared Headers & Cookies section excludes API and `APIForm` provides only params, headers, and body. The API worker still reads common cookies, so this is a reachable runtime capability with no current creation/edit UI. | Put the canonical protected cookie editor in the API request/credentials step and test plain, protected, env-backed, scoped, and legacy v2 cookies through preview and worker execution. | 2, 3, 5 |
| V2-10 | High | REST API edit/save drops or misnames mapping data. The caster omits `guidIsPermaLink`, `feedLinkPath`, and `feedLastBuildDatePath`, and writes legacy flattened/suffixed enclosure, source, and feed metadata keys while the runtime model reads nested/canonical keys. Some schema drift predates v3, but v3 editing makes it destructive for valid hand-authored configs. | Normalize both historical shapes to one canonical API mapping, preserve all supported fields, and test actual mapped output—not only caster object presence. | 3, 5 |
| V2-11 | Medium | The v2 type tabs allowed a user to switch web/API/email while composing. v3 Back/Discard unmounts the builder and does not pass the captured `formValues` back when another type is selected; there is no unsaved-change confirmation. | Either preserve per-type in-progress state while switching or confirm the destructive reset. Keep unrelated type data out of the submitted config. | 5 |
| V2-12 | Medium | The FlareSolverr status badge used to open Additional Options, scroll to the control, and highlight it. In the sectioned builder it merely looks for an element that is not mounted unless Advanced is already active, so the normal click is a no-op. | Make the badge navigate through builder section state, focus the control, and announce health; cover keyboard and mobile behavior. | 5 |
| V2-13 | Medium | The new top-level `enabled` state is omitted by `configToFormData`, while the caster hard-codes `enabled: true`. Editing a disabled feed re-enables it. This is a v3 regression adjacent to the v2 migration path. | Preserve enabled state on edit and make state transitions explicit; add a disabled-feed round-trip test. | 3, 5 |
| V2-14 | Medium | The new cookie editor exposes protected/env values and domain/path/secure/httpOnly metadata, then its wrapper reduces entries to v2 `{name,value}` strings. Basic v2 cookies survive, but the advertised v3 security and cookie-scoping behavior does not. | Use the canonical rich cookie model end to end and migrate simple v2 cookies losslessly. | 2, 3, 5 |
| V2-15 | Release-process blocker | Existing tests exercise isolated converters but do not assert semantic v2 config round trips or the old user workflows. That allowed mutually incompatible converter/caster shapes to coexist. | Establish checked-in web/API/email v2 golden configs and a UI/action parity matrix before implementation continues; require those tests in Packet 1 CI and Packet 10 migration rehearsal. | 1, 10 |

### Verified preserved surfaces

These do not currently require restoration, but need parity tests so later hardening does not remove them:

- Selector Playground is still reachable from the Selectors step and retains the same 16 item/feed selector destinations; its problem is unsafe isolation, not absence.
- FlareSolverr configuration and health, proxy, preview, scheduled web worker, drill-fetch, and playground paths remain in the tree; they need one secure adapter and end-to-end proof.
- The v2 utility endpoints (`/proxy`, `/passkey`, `/imap/folders`, `/utils/suggest-selectors`, `/api/flaresolverr/health`, `/utils/root-url`, and `/trigger-webhook`) remain mounted, as do the legacy create, preview, list, and delete routes.
- The visible v2 web selector fields, REST API request/mapping inputs, and IMAP connection/filter inputs are still represented. Most losses occur after input—through section reachability or serialization—rather than wholesale field deletion.
- Continuous IMAP watching/reconnect behavior, Chrome-extension loading for advanced Playwright scraping, config/extensions volume mounts, `SERVER_URL`, and the v2 passkey/cookie/encryption/SSL CLI/environment inputs remain present.
- RSS output remains available alongside the new Atom and JSON outputs; preserving RSS behavior is a compatibility gate, not a reason to reject the additional formats.

Two visible v2 controls are intentionally **not** parity requirements because the v2 runtime did not implement their implied behavior: Advanced/FlareSolverr settings shown while building an API feed were only consumed by the web-scraping worker, and the universal Preview button had no live-email preview implementation. Keep FlareSolverr fully supported for web scraping. For email, show an honest unavailable state until a real preview exists instead of recreating a misleading button.

### Compatibility acceptance rule

The audit's focused test run passed all 28 existing converter/caster tests, yet a composed v2 web fixture still changed `enabled: false` to true, serialized `Authorization` under key `"0"`, erased field iterator/drill/GUID semantics and feed metadata, and dropped webhook headers/custom payload. This is the concrete test gap V2-15 closes.

For each golden v2 config, compare a canonical semantic representation before and after load→edit-without-change→preview→save→restart. Unknown but supported legacy fields must be retained by the migration layer; protected values must remain masked in APIs and resolve to the same bytes at runtime. A changed schema version, ciphertext envelope, normalized alias, or generated default is acceptable only when runtime behavior is equivalent and the migration is documented. Any other diff fails the release gate.

## Dependency graph

```text
Packet 0  Decision and scope lock
   |
Packet 1  Reproducible quality/dependency baseline
   |
Packet 2  Trust boundary, secrets, and deployment security
   |
Packet 3  Runtime/config/network platform contract
   +----------------------+----------------------+
   |                      |                      |
Packet 4              Packet 5               Packet 8
Frontend platform     Builder contract        Templates/catalog
   |                      |
   +----------+-----------+
              |
        Packet 6  Source Assistant + web intelligence
              |
      +-------+--------+----------------+
      |                |                |
  Packet 7A        Packet 7B        Packet 9
  Remote sources   Ingress/local    Service connectors
      +----------------+----------------+
                       |
                 Packet 10 Release proof
```

Packets 4 and 5 should be sequential if one agent is doing all frontend work. With multiple agents, they may overlap only after agreeing on the source registry and avoiding edits to `BuildFeedPage.tsx`, `FeedBuilderForm.tsx`, shared field primitives, and navigation at the same time. Packets 7A, 7B, 8, and 9 are the intended parallelization point.

## Execution packets

### Packet 0 — decision, scope, and documentation lock

**Purpose:** prevent implementation agents from making incompatible product/security decisions midstream.

**Owned artifacts:** v3 roadmap, missing redesign specs/plans, architecture decision records, `docs/superpowers/PROGRESS.md` status semantics.

**Work:**

- Carry the locked product decisions and resolved implementation defaults into the implementation ledger/ADRs; packet owners must not reopen them without a new product decision.
- Freeze the v3 source list to web scraping, REST API, email, feed transformer, sitemap, calendar, GraphQL, webhook, filesystem, and service connector. Exclude the unspecified `changeDetection` type while retaining v2 capabilities, Selector Playground, and FlareSolverr as defined above.
- Add scoped specs/plans for “UI Redesign Correction Pass” and “Workbench v2 Frontend Redesign,” including breakpoints, workflow, accessibility, and performance acceptance criteria.
- Replace the meaning of the progress tracker's implementation column with evidence-backed states: Not started, In progress, Blocked, Verification, Ready.
- Create a single implementation-status ledger containing packet owner, TDD slice/brief, Claude Sonnet 5 session, accepted test files, RED/GREEN commands, commit/PR, migrations, and outstanding risks. Do not duplicate status across several documents.

**Exit criteria:** all questions that affect storage, security boundaries, supported sources, or public behavior are decided; the v3 source list and release policy are frozen.

**Estimated complexity:** Small, decision-heavy. **Must precede code changes.**

### Packet 1 — reproducible quality gates and dependency baseline

**Purpose:** make subsequent progress measurable and prevent new debt while existing code is changed.

**Primary surfaces:** root/frontend `package.json`, lockfile, TypeScript/Biome config, Playwright config and fixtures, `.github/workflows/`, Docker build/test workflows.

**Work:**

- Upgrade Hono, Axios, `js-yaml`, frontend dependencies, and reachable transitive vulnerabilities; replace abandoned `xmldom` with a maintained, bounded XML parser.
- Remove unused/misclassified dependencies (`zod`/resolvers if still unused, `readline`, runtime `bun`, duplicate Bun types, unused XML types) or deliberately adopt them.
- Add deterministic root and frontend scripts for lint, typecheck, unit tests, catalog validation, production build, browser tests, and dependency audit.
- Keep the repository-level `tdd:claude`, `tdd:tests`, and consolidated `verify:*` commands cross-platform and covered by smoke checks. Test-author automation must reject a non-Sonnet-5 response and any Claude edit outside `tests/` or `frontend/e2e/`; implementation handoff must fail when accepted test hashes change.
- Include `frontend/` in the checked-in lint configuration. Fix existing errors in files touched by later packets immediately; clear remaining baseline errors here where mechanical.
- Replace POSIX-only Playwright startup syntax with a cross-platform server launcher. Add Linux and Windows CI coverage, a 390 px project, and `@axe-core/playwright` (or equivalent) representative checks.
- Add dependency policy, full-history secret scanning, SAST, container/IaC scanning, SBOM generation, and a guard that rejects unapproved direct network primitives outside the shared executor introduced in Packet 3.
- Establish clean-install reproducibility from the lockfile and cache only keyed, integrity-checked artifacts.

**Exit criteria:** one CI command reproduces all available checks; Windows and Linux can launch browser tests; no lint/typecheck errors; dependency findings meet the release policy or have time-bounded documented exceptions.

**Audit coverage:** B4, C3, C12, E8, H1–H3 where build/tooling-related, S7, V2-15, and the security-CI portion of S10.

**Estimated complexity:** Medium. Keep this packet infrastructure-only; do not opportunistically redesign application code.

### Packet 2 — trust boundary, protected values, and deployment hardening

**Purpose:** close exploitable application boundaries before adding more reachable source functionality.

**Primary surfaces:** `index.ts` middleware/static mounts, passkey/session routes, `routes/utils.ts`, `SelectorPlayground.tsx`, protected-value utilities/models, IMAP worker launch, secrets/config startup, Dockerfile/compose/deployment docs.

**Work:**

- Remove loopback address as authorization. Require authentication by default; make any development bypass explicit, off by default, and impossible to enable accidentally in production.
- Define trusted-proxy behavior only for client-IP observability—not authorization. Add timing-safe passkey verification, login throttling, session-cookie hardening, origin/CSRF protection for state changes, and a deliberate independently authenticated webhook exception.
- Remove raw `/configs/*` static serving. Add CSP, frame controls, content-type/nosniff, referrer, and other appropriate security headers.
- Retain and isolate Selector Playground according to the locked product decision. Serve a purpose-built sanitized document, remove target scripts/event handlers/forms/base navigation, self-host and pin SelectorGadget, apply a restrictive CSP, use an opaque-origin `allow-scripts`-only sandbox, and bind schema-validated `postMessage` traffic to the exact iframe plus a short-lived nonce. Do not pass FlareSolverr configuration in query strings.
- Replace protected-value AES-CBC with a versioned AES-256-GCM envelope; require a valid random 32-byte key format; fail startup on placeholders/invalid production secrets; preserve exact plaintext bytes.
- Implement explicit read-old/write-new migration, bulk migration/verification, key rotation, rollback/recovery documentation, and tamper/wrong-key tests.
- Keep the master key out of arguments, process titles, logs, and errors. Use private IPC/stdin or keep decryption in the parent and transfer only the minimum credential to the child. Add capture-based leak regression tests.
- Remove committed/dev default credentials from scripts and compose. Run as a non-root user, make the image/root filesystem immutable where practical, restrict writable mounts/capabilities, add health/readiness, and document safe reverse-proxy/TLS deployment.
- Replace raw `console.*` on sensitive paths with a structured redacting logger and correlation IDs. Keep sanitized diagnostics useful without serializing headers, bodies, cookies, tokens, URLs with credentials, or key material.

**Exit criteria:** A1/A2 and S1/S2/S5/S8 are closed; Selector Playground still selects and assigns all 16 destinations without access to app cookies/APIs or arbitrary parent messaging; a secret cannot appear in config APIs, logs, process arguments, drafts, feeds, or error responses; security integration tests cover anonymous, authenticated, CSRF, proxy, and key-migration paths.

**Feature coverage:** Protected Value Encryption and the security portion of Email Worker Multi-Format + History.

**Compatibility coverage:** locked Selector Playground isolation plus V2-02, V2-04, V2-14, and V2-16 protected-value boundaries.

**Estimated complexity:** Large. Use one security-oriented agent for the complete packet to avoid splitting the threat model.

### Packet 3 — runtime, configuration, settings, network, and resource-control platform

**Purpose:** create the stable backend contracts every source feature will use.

**Primary surfaces:** feed-config models/caster/normalizer/validator/route adapter, config manager, analytics/Drizzle schema and migrations, settings/profile routes and utilities, outbound/fetch utilities, worker manager, preview and feed routes.

**Work:**

- Make the backend `FeedConfig` union and one source-definition registry authoritative for type IDs, schema version, validation, protected fields, runtime dispatch, preview support, and output capabilities.
- Finish strict per-type validation. Reject unknown or disabled types and irrelevant/unsafe fields; preserve old YAML through an explicit normalizer; emit only the current schema on write. Treat the V2-01/02/04/06/10/13/14/16 golden round trips as contract tests, including lossless CSS targets, RSS metadata, headers/cookies, webhook customization, API mappings, enabled state, and masked protected values.
- Reconcile `settings` vs `app_settings`, use managed Drizzle migrations for all runtime tables, document backup/restore, expose degraded DB state through readiness, and execute the SQLite real-data/lazy-migration smoke plan.
- Preserve and gate the Ready format/normalized pipeline: all workers write RSS/Atom/JSON through the canonical builder, and history stores normalized item snapshots.
- Build one outbound HTTP(S) executor used by all application code. It must validate schemes/ports/credentials, resolve and validate every address, avoid DNS time-of-check/time-of-use gaps, preserve TLS SNI/Host, revalidate every redirect, cap compressed/decompressed bytes, apply one total deadline, and return sanitized attempt metadata.
- Put browser automation and required FlareSolverr support behind explicit adapters with separately documented trust/egress controls. Preserve explicit preview, scheduled worker, drill-chain, selector-suggestion, and Playground flows. Validate the service endpoint and target separately, bind requests to the validated destination, intercept browser subresources, enforce total budgets, and document restricted service-level egress. Prohibit direct `fetch`, Axios, FlareSolverr posts, or browser navigation outside approved low-level adapters with an architecture test.
- Reconnect sample-HTML relative URL inference and the CSS-target builder so create, edit, preview, and scheduled execution share one implementation; eliminate fetched-but-unused `sampleHtml`.
- Implement retry/fallback modes once, with typed retryable failures, bounded attempts/backoff, cancellation, per-feed concurrency, global queue backpressure, and a total run budget.
- Replace the duplicate setting paths with one typed settings registry containing defaults, validation, secret classification, live-vs-restart behavior, and runtime consumers. Prove save→restart→behavior for every setting.
- Persist user-agent/proxy profiles, encrypt credentials, implement authorized CRUD/test/reference validation, and resolve profiles through the shared executor for every supported source.
- Add global and route-specific body limits before parsing, bounded parser inputs, webhook/event limits, filesystem limits, and a safe strategy for user-provided regex (restricted syntax/engine or interruptible evaluation).
- Complete backend route-decomposition smoke parity and add middleware/mount integration tests. Keep route prefixes explicit enough to audit.

**Exit criteria:** no user-controlled URL sink bypasses the shared executor; explicit FlareSolverr flows retain v2 behavior inside the hardened adapter; settings visibly change enforced runtime behavior; representative v2 configs round-trip without semantic loss; SQLite migration/recovery is demonstrated; limits/concurrency/cancellation tests pass.

**Feature coverage:** Feed Config Formalization, SQLite Runtime Substrate + Feed History, Outbound Fetch Policy, Feed Format Refactor, Normalized Feed Item Pipeline, Settings Page backend, Backend Route Decomposition, Fetch Policy / Retry / Fallback, and Proxy / User-Agent Profiles backend.

**Audit coverage:** S3, S4, S6, S11, D10/D11, H4/H5 backend portions, V2-01/02/04/06/07/10/13/14/16, and the substrate portions of every source readiness finding.

**Estimated complexity:** Extra large and on the critical path. Do not parallelize modifications to the executor/config/settings contracts. Freeze and document their APIs at exit.

### Packet 4 — frontend platform, navigation, My Feeds, health, and design system

**Purpose:** fix cross-page frontend behavior once, before feature pages inherit more inconsistent patterns.

**Primary surfaces:** app shell/router, sidebar/bottom nav, design tokens/global CSS, shared UI primitives, toast/dialog/error handling, `MyFeedsPage`, feed list/detail/actions, Health pages/hooks/charts.

**Work:**

- Create one frontend source-type registry sourced from or contract-tested against the backend registry. Centralize labels, descriptions, icons, colors, route IDs, and capability flags; delete the seven divergent maps and duplicated SVGs.
- Select one token system. Fix documented contrast failures, load or remove promised fonts, resolve animation-class collisions, add reduced-motion behavior, and either finish dark mode coherently or remove its dead surface per Packet 0.
- Make navigation complete at all breakpoints, including Health and Settings; add current-route semantics, landmarks, skip link, correct heading order, per-route titles, a 404 route, and an application error boundary.
- Make toast context stable and accessible; replace all `alert()` calls; add `aria-live`/status semantics and mobile-safe placement.
- Centralize API mutation behavior: require `response.ok`, parse typed errors, cancel stale requests, snapshot and roll back optimistic state, and present useful failures.
- Implement the decided delete behavior. Fix the portal/outside-click action menu, duplicate Open/Preview behavior, clipboard/download races, persisted/shareable filter state, and source-summary null safety. Restore the v2 manual **Trigger Webhook** action with proper eligibility, pending, success, and error states.
- Rebuild the feed detail drawer on the existing accessible dialog primitive with focus management, Escape, inert background, names/descriptions, and keyboard tests.
- Fix Health ordering, failed-fetch states, SSE reconnect behavior, N+1 sparklines, chart legends/text alternatives, and render-time side effects.
- Consolidate duplicate switches/field primitives and remove dead CSS/components/dependencies in this ownership area. Add route-level code splitting so charting code does not load on builder routes.

**Exit criteria:** shell/My Feeds/Health/Settings navigation is keyboard- and mobile-usable; mutation errors cannot masquerade as success; representative axe checks pass; default text/borders meet WCAG AA; no owned dead/duplicate UI remains.

**Feature coverage:** App Shell / Navigation Redesign, My Feeds Redesign, UI Redesign Correction Pass shared UI, and the shared frontend portion of Settings.

**Audit coverage:** B3/B5, C4–C6, C8–C11, D1–D5/D7–D9/D12, E1/E7/E9, F1–F6, G1–G9 where platform/list/health-related, H1 frontend splitting, and V2-05.

**Estimated complexity:** Large. Keep one frontend-platform agent on this packet through accessibility and browser tests.

### Packet 5 — workbench, builder contract, forms, preview, and drafts

**Purpose:** make one reliable builder that source packets can extend without reopening its architecture.

**Primary surfaces:** `BuildFeedPage`, `EditFeedPage`, `BuilderLayout`, `FeedBuilderForm`, form converter/types, preview components/hooks, form primitives, draft hook/dialog, source form registration.

**Work:**

- Define one exhaustive source UI registry: builder route, sections, form component, default safe values, serialization adapter, supported capabilities, and availability. Remove unreachable “active/soon” branches and raw fallbacks.
- Replace the no-op `buildFeedConfigFromFormData` with per-type serialization aligned to the Packet 3 contract. Submit only common fields plus the selected source block; never seed or persist fields for unrelated types. The edit adapter must preserve enabled state and every unedited v2 field represented by the Packet 3 normalizer.
- Give each source explicit steps. Remove inherited web-scraping selectors/options from types that do not support them. Restore API cookies in its request/credentials step. Give email an Output/Delivery step for reverse, strict, and outbound webhook settings. Restore the webhook enable control and preserve custom headers/payload. Require accessible labels/descriptions/errors for every field and selection state.
- Make the builder responsive: full-width form on small screens, preview as a separate step/drawer, usable step navigation, no fixed-width collision, and no horizontal overflow at 390 px.
- Use one submission state for every Save/Publish entry point, prevent duplicate submissions, add unsaved-change protection, preserve focus/error location, and use the shared mutation client. Preserve per-type drafts when switching types or explicitly confirm their destruction.
- Replace fabricated preview XML with an honest empty state and actual preview response. Escape/render output safely, distinguish stale/loading/error/sample/real states, and support RSS/Atom/JSON consistently.
- Replace draft redaction with a schema-derived safe allowlist; never persist protected/unknown fields. Version drafts, purge legacy unsafe drafts, scope them per feed/type, and test every sensitive field.
- Retain Selector Playground in the Selectors step with all 16 assignments and the Packet 2 isolated transport. Make the FlareSolverr status control switch to Advanced, focus/announce its setting and health, and remain usable by keyboard and at 390 px.
- Remove builder-specific orphaned components/props and render-loop patterns while context is loaded. Do not defer them to a cleanup packet.
- Add contract tests for every type serializer and browser coverage for landing→type→form→preview→save/edit on desktop and mobile using representative simple fixtures.

**Exit criteria:** no cross-type fields are submitted; no secret enters browser storage; every enabled source has deliberate steps; all v2 common controls are reachable for their applicable source; Playground and FlareSolverr configuration retain parity; preview is real; save is single-shot and nondestructive; builder is usable at 390 px and passes keyboard/axe checks.

**Feature coverage:** Builder UI Redesign, Workbench v2 Frontend Redesign, Auto-save Draft, and the frontend half of Feed Config Formalization.

**Audit coverage:** B2/B6/B7, C2/C7, D6/D13, E2/E3/E6/E7, builder portions of G1–G9, and V2-01/02/03/06/09–14/16.

**Estimated complexity:** Large. Complete before source-specific UIs are finalized.

### Packet 6 — Source Assistant, transformer, JSON-LD, and form-based web intelligence

**Purpose:** finish the features that share observation, detection, recommendation, starter-config, drill, and web-document parsing context.

**Primary surfaces:** source-assistant models/routes/hooks/panel, scorers and starter adapters, discovery/parser/transformer, JSON-LD utilities and drill UI, form detection/request builder, related builder forms.

**Work:**

- Replace alias “adapters” with real route-specific starter builders that emit Packet 5 form-valid data. Use an exhaustive compile-time map; no `?? webScraping` fallback.
- Repair scorers using explicit observations rather than URL substrings. Return traceable evidence and calibrated rank ordering; remove fake precision and inactive scorers or implement them.
- Fix calendar and every other recommendation→builder route. Applying a recommendation must hydrate the selected form without reanalysis; manual creation must remain available.
- Restore the direct v2 URL→**Suggest Selectors** action. Use the same typed apply adapter as Source Assistant and populate iterator, selector, attribute, relative/base URL, enclosure, date, and author data completely rather than only selector strings.
- Replace simulated named progress with an honest indeterminate analysis state plus cancellation. Surface partial analysis failures and useful error states.
- Finish the existing-feed transformer using the maintained bounded XML parser, normalized output, shared executor/policy, stable dedupe, and real create→preview→scheduled-output tests.
- Implement JSON-LD page and bounded drill workflows with candidate/path selection, malformed/oversize handling, shared total budget, and policy enforcement on every extracted URL.
- Build a repeatable form-data editor with add/remove/reorder, protected values, GET, URL-encoded POST, JSON POST, and only genuinely supported encodings. Make assistant, preview, and worker call the same request builder.
- Cap observation/document/parser sizes and sanitize every diagnostic. Add hostile HTML/XML/JSON/form fixtures and golden recommendation/starter-config tests for every enabled route.

**Exit criteria:** every enabled recommendation applies to the correct populated builder; transformer/JSON-LD/form workflows use the same safe execution and config contracts in preview and worker; no fake progress or confidence remains.

**Feature coverage:** Existing Feed Transformer, Source Assistant Backend Core, Source Assistant Frontend, JSON-LD Integration, and Web Scraping Form Data.

**Audit coverage:** B1, C1, C13, E4/E5, V2-07/V2-08, and related network/parser/security findings already platformed in Packets 1–3.

**Estimated complexity:** Extra large. Keep these together because splitting detection, starter config, and form hydration would repeatedly reload the same domain model.

### Packet 7A — remote structured sources: Sitemap, Calendar, and GraphQL

**Purpose:** complete remote-source verticals after the shared executor and builder contracts are frozen.

**Owned source surfaces:** Sitemap, Calendar, and GraphQL models/utilities/forms/worker branches/tests. Avoid changing shared executor/registry APIs; propose changes back to Packet 3 ownership if needed.

**Sitemap work:** bounded recursive sitemap-index traversal, discovery mode, compressed/large input handling, filters, page metadata/JSON-LD enrichment and fallback, SQLite first-seen state, warnings/partial failure, assistant recommendation/apply, and full builder/worker coverage.

**Calendar work:** adopt a maintained ICS parser; support folded/escaped lines, `TZID`, DST-safe bounded recurrence, recurrence exceptions/cancellations, stable GUIDs, filters, assistant routing, and malformed/large input limits. Do not expose CSS/web-scraping controls.

**GraphQL work:** variables, operation name, protected headers, query runner, array-path discovery, complete field mapping, data-with-errors warnings versus errors-without-data failure, pagination only if explicitly v3-scoped, and policy/limit enforcement.

**Exit criteria:** each source passes create/edit/preview/save/worker/RSS-Atom-JSON/failure/restart tests with realistic fixtures; builder fields cover the documented v3 schema; no direct network calls.

**Feature coverage:** Sitemap, Calendar, GraphQL.

**Estimated complexity:** Extra large. If split among agents, assign one complete source per agent; do not split a source into backend/frontend/test agents.

### Packet 7B — ingress and local sources: Webhook, Filesystem, and Email

**Purpose:** finish sources that share durable state, triggering, retention, restart behavior, and nonstandard trust boundaries.

**Owned source surfaces:** webhook route/utility/form, filesystem route/utility/form, email/IMAP worker and tests, source-specific Drizzle migrations.

**Webhook work:** implement the Packet 0 storage/auth decisions; generate and show a token exactly once; store only its hash; accept header credentials only; exempt ingestion from session auth deliberately while retaining independent bearer auth; use timing-safe verification; enforce body/shape/depth/rate/retention limits; append transactionally; regenerate atomically; rebuild on startup; return a deployment-aware URL/curl example; and test concurrency/restart/dedupe.

**Filesystem work:** canonicalize and authorize configured paths at save and run time; defend symlinks/junctions and path races on supported platforms; provide approved-root selection, patterns and mapping controls; persist state in SQLite; bound count/file/preview sizes; implement the Packet 0 item-link decision; and test a real temporary directory tree.

**Email work:** complete the secure worker secret channel from Packet 2, preserve v2 reverse/strict/outbound-webhook behavior through the new Output/Delivery step, transmit protected webhook headers/custom payload to the delivery worker, verify SQLite snapshots/deduplication and all formats across worker restarts, bound message/attachment parsing, sanitize content, and add a mock/live-fixture end-to-end path without leaking credentials.

**Exit criteria:** independently authenticated webhook ingestion, filesystem roots, and IMAP credentials are safe at their boundaries; state/retention/restart behavior is deterministic; all three sources pass vertical tests.

**Feature coverage:** Webhook, Filesystem, Email Worker Multi-Format + History.

**Audit coverage:** S1/S6/S9, V2-04/V2-09, plus the source-specific readiness gaps.

**Estimated complexity:** Large. These may be split by source only after shared persistence/auth interfaces are fixed.

### Packet 8 — parameterized templates and community catalog

**Purpose:** finish config sharing as one trusted import pipeline rather than separate template and catalog implementations.

**Primary surfaces:** template model/utility, catalog client/routes/UI, manifest/sample/validation workflow, import/export sanitization, connector request docs.

**Work:**

- Use one parser/validator/sanitizer for manual imports, bundled catalog, and remote catalog. Validate schema and parameters before preview or write; assign new local IDs and safe origins; never accept executable behavior or paths outside the config schema.
- Implement the manual YAML import flow with clear validation errors, typed parameter input, protected-value choices, masked edit semantics, and a preview-before-save path.
- Prohibit plaintext secret material in catalog/template artifacts and strongly prefer disallowing plaintext secret storage in the UI. Ensure exports/catalog submissions cannot include protected ciphertext or resolved values.
- Implement the approved repository-backed remote client: GitHub Pages is the preferred static source, raw GitHub `main` is the fallback, and a persistent last-known-good cache supplies offline behavior. Bound and validate manifest/YAML retrieval, enforce schema/catalog-version compatibility and path containment, expose source/staleness, and treat only pull-request-reviewed, catalog-CI-passing repository content as official. Do not add an independent catalog service or user-configured authorities to the v3 MVP.
- Expand validation beyond the single sample. Add malicious templates, traversal/anchors/alias bombs, incompatible schema, secret leakage, offline cache, and multi-entry integration tests.
- Verify the already-ready service-connector issue form, repository labels, `CONTRIBUTING.md`, review checklist, and design-template links after merge.

**Exit criteria:** manual/bundled/remote imports share one safe pipeline; no secret can enter or exit a catalog artifact; offline fallback and compatibility behavior are proven; catalog CI is required.

**Feature coverage:** Parameterized Feed Config Templates, Community Catalog, Service Connector GitHub Issue Template verification.

**Estimated complexity:** Large. Can run parallel to source packets after Packet 3 and the builder import contract are frozen.

### Packet 9 — first-class service connectors

**Purpose:** finish the connector framework and Jellyfin as the proof that it works end to end.

**Primary surfaces:** connector definitions/registry/runner/state, connector routes, Jellyfin adapter, builder form, profile/protected-value integration, connector catalog guards.

**Work:**

- Define a typed connector contract for metadata, auth fields, resource discovery, presets, normalized mapping, state/dedupe, capabilities, validation, and compatibility.
- Complete list definitions, connection test, resource discovery, preset selection, preview, save/edit, scheduled worker, and output UI/API paths. Replace raw ID/text entry with validated selectors.
- Route every connector request through Packet 3's executor and profiles. Store credentials only as protected values and connector state only through managed Drizzle migrations.
- Enforce private/local-only defaults for feeds derived from private services and make exposure explicit. Prove connector configs are rejected from the public community catalog/export path.
- Implement a mocked Jellyfin vertical suite: authentication failure, server test, library discovery, preset preview, save, scheduled refresh, new-item dedupe, restart, all output formats, policy denial, and secret-leak assertions.
- Keep the framework honest: do not advertise unimplemented services or generic capabilities in v3.

**Exit criteria:** Jellyfin completes the documented create→test→discover→preview→save→worker flow; policy, protected credentials, privacy default, state migration, and catalog exclusion are tested.

**Feature coverage:** Service Connectors and connector use of Proxy / User-Agent Profiles.

**Estimated complexity:** Large. Start only after Packets 2, 3, and 5.

### Packet 10 — release proof, migration rehearsal, and documentation truth

**Purpose:** prove the integrated product rather than discovering feature defects after versioning.

**Primary surfaces:** test fixtures/suites, release scripts, deployment examples, migration/backup docs, progress/release notes. This packet should contain minimal product-code changes; substantial failures return to their owning packet.

**Work:**

- Run the entire CI matrix from a clean clone/lockfile on Windows and Linux/Docker: lint, typecheck, 438+ backend tests, catalog validation, production build, dependency/security scans, desktop/mobile browser tests, and axe checks.
- Add/execute an integration matrix for every v3 source: create, edit, preview, save, restart, scheduled/triggered update, RSS/Atom/JSON, invalid input, remote failure, cancellation, limits, dedupe/history, and secret non-disclosure.
- Rehearse upgrade from representative v2 configs, CBC protected values, file feed-history, and existing runtime DB. Verify backup, forward migration, rollback/recovery, key rotation, and idempotent restarts.
- Execute the v2 parity matrix for web scraping, REST API, email, My Feeds actions, Selector Playground, selector suggestion, advanced scraping/Chrome extensions, FlareSolverr, IMAP watching, and CLI/container configuration. Compare generated RSS semantics as well as saved YAML.
- Threat-test auth, session/CSRF, the retained isolated Selector Playground, every outbound sink including each FlareSolverr flow, DNS/redirect/subresource cases, webhooks, file roots, parser bombs, rate/concurrency limits, logs, and container runtime.
- Measure 390 px, tablet, and desktop critical flows; verify keyboard/screen-reader semantics, contrast, reduced motion, error boundary, and 404 behavior.
- Measure startup, feed-run concurrency, large input limits, and frontend bundles. Set and enforce budgets instead of accepting warnings silently.
- Perform the backend decomposition's complete manual smoke checklist and a deployment smoke test behind the documented reverse proxy.
- Update all 31 feature verdicts and plan checkboxes with linked evidence. Write v3 release notes including breaking changes, migration steps, removed/deferred features, known limitations, and security guidance.

**Exit criteria:** all release-policy gates pass; no Critical/High release blocker remains; every shipped feature is Ready with linked evidence; clean install and v2 upgrade are both successful; version/tag/image publication is the only remaining action.

**Estimated complexity:** Medium if earlier packets finish vertically; large if it uncovers deferred work.

## Feature coverage crosswalk

Every feature from the readiness review has exactly one primary completion packet:

| Feature | Primary packet | Target outcome |
|---|---:|---|
| Protected Value Encryption | 2 | AEAD, migration, rotation, no process/log leakage |
| Feed Config Formalization | 3 | Authoritative backend contract; Packet 5 consumes it |
| SQLite Runtime Substrate + Feed History | 3 | Verified migration, one managed schema, recovery docs |
| Outbound Fetch Policy | 3 | Universal DNS/redirect-aware executor |
| Feed Format Refactor | 3 | Preserve Ready status and enforce in CI |
| Normalized Feed Item Pipeline | 3 | Preserve Ready status and enforce for all new sources |
| Email Worker Multi-Format + History | 7B | Secure, bounded, restart-tested IMAP vertical |
| Auto-save Draft | 5 | Schema-derived safe persistence only |
| App Shell / Navigation Redesign | 4 | Complete responsive/accessible navigation |
| My Feeds Redesign | 4 | Correct mutations/delete/menu/dialog behavior |
| Builder UI Redesign | 5 | Responsive, type-correct, real preview/save |
| UI Redesign Correction Pass | 4 | First specify, then close platform/UI audit findings |
| Workbench v2 Frontend Redesign | 5 | First specify, then close workbench acceptance criteria |
| Settings Page | 3 | Typed settings connected to runtime behavior |
| Backend Route Decomposition | 3 | Parity and middleware integration proved |
| Existing Feed Transformer | 6 | Maintained parser and safe end-to-end transform |
| Source Assistant Backend Core | 6 | Real observations/scorers/starter adapters |
| Source Assistant Frontend | 6 | Correct apply/hydration/error/progress behavior |
| JSON-LD Integration | 6 | Bounded page/drill selection flow |
| Web Scraping Form Data | 6 | Protected repeatable fields and shared request builder |
| Fetch Policy / Retry / Fallback | 3 | One enforced bounded state machine |
| Proxy / User-Agent Profiles | 3 | Persisted protected profiles used by all fetchers |
| Parameterized Feed Config Templates | 8 | Safe manual and catalog template pipeline |
| Community Catalog | 8 | Trusted remote/local/cache behavior |
| Service Connector GitHub Issue Template | 8 | Preserve Ready status and verify repository integration |
| Sitemap | 7A | Recursive/enriched/stateful vertical |
| Calendar | 7A | Standards-capable timezone/recurrence vertical |
| GraphQL | 7A | Full query/discovery/mapping vertical |
| Webhook | 7B | Independent bearer auth and durable bounded ingestion |
| Filesystem | 7B | Root-safe stateful local-source vertical |
| Service Connectors | 9 | Complete private-by-default Jellyfin proof |

## Agent allocation and token-efficiency guidance

The best use of multiple implementing agents is **sequential specialization first, parallel source verticals later**:

| Agent specialization | Recommended packets | Reason |
|---|---|---|
| Claude Code Sonnet 5 test author | Every implementation slice | Receives a narrow requirements brief, writes/revises tests only, and proves RED; never writes production code. |
| Security/runtime | 2 → 3 | Retains the threat model and shared backend contracts in one context. |
| Frontend platform | 4 → 5 | Reuses design-system, accessibility, router, mutation, and form context without handing off high-churn UI files. |
| Web intelligence | 6 | Keeps detection, scorers, adapters, parsers, JSON-LD, and form hydration together. |
| Source verticals | 7A sources, 7B sources, 9 | Parallelize by complete source—not frontend/backend layer—after contracts freeze. |
| Distribution/release | 8 → 10 | Reuses validation/import/security and documentation/CI context. |

For each slice, Codex gives Claude Sonnet 5 only the requirements brief and its cited sources. Codex scrutinizes the resulting tests against the brief and returns a concise delta review to the same Claude session until coverage is complete. Only then does the implementing agent receive the packet section, accepted tests, owned code paths, and contract context needed for GREEN. Require a closing handoff containing changed contracts, migrations, RED/GREEN evidence, broader verification, deferred work, and exact evidence links. Avoid feeding every historical audit or Claude transcript to every agent.

Do not let test authoring and implementation write concurrently in the same slice. Do not run parallel implementing agents on the same packet or overlapping high-churn files. If a source packet discovers a shared-contract defect, stop and route it back to the Packet 3 or Packet 5 owner rather than creating a local exception. Codex must never patch an accepted or deficient Claude-authored test; requirement/test gaps go back through the scripted revision loop.

## Resolved implementation defaults

All remaining recommended defaults were accepted on 2026-09-02. These are implementation decisions, not questions for individual packet owners to reopen:

1. **Authentication:** no loopback authorization bypass in v3. Require passkey/session everywhere except deliberately independent endpoints such as webhook ingestion. A developer-only bypass may exist only behind an explicit non-production flag.
2. **Protected-value compatibility:** support one explicit read-CBC/write-GCM migration release plus a verified migration/rotation command; never silently reinterpret ciphertext or require routine secret re-entry.
3. **Change Detection:** hide/remove the unspecified `changeDetection` type from the v3 UI and supported-type registries while preserving any old configs read-only. Schedule implementation only after a dedicated specification.
4. **Webhook ingestion:** store events in SQLite through managed migrations. Accept bearer-header credentials only; deliberately exempt the public ingestion route from session auth while independently authenticating, rate-limiting, and body-capping it.
5. **Filesystem item links:** do not expose a general file-serving endpoint in v3. Use stable item GUIDs and an optional explicitly configured safe public base URL. Any restricted serving feature requires a separate threat model.
6. **Delete UX:** remove the fake Undo behavior and use an accessible confirmation before immediate deletion. Do not add soft delete without a separately approved retention/restore requirement and DB/API design.
7. **Source Assistant progress:** use an honest cancellable indeterminate state. Do not build SSE/stage events unless later evidence establishes a need for actionable long-running diagnostics.
8. **Theme and platform support:** formally support Linux/Docker runtime plus Windows development/CI. Remove the inactive dark-mode surface from v3 unless a complete, coherent, tested dark mode is deliberately added before the Packet 0 scope lock.
9. **GraphQL pagination:** ship a single bounded query for v3. Do not imply or implement cursor/page pagination unless a separately documented target-service requirement expands the scope.
