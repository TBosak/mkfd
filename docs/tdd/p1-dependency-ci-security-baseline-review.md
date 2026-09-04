# Test Scrutiny Review: `p1-dependency-ci-security-baseline`

## Verdict

`RETURN TO CLAUDE`

The first draft is strong. It parses real YAML/lock/manifest structures instead of grepping text, resolves `runs-on` against the matrix that defines it, distinguishes root from frontend frozen installs, compares semver correctly across multi-digit and prerelease boundaries, and carries helper-correctness fixtures for every non-obvious predicate. Independent RED reproduction: **63 pass / 65 fail** across the eight backend files (Codex ran the same eight files; the three additional cascading failures Claude reported inside the locked static suites are the expected `@axe-core/playwright` missing-module diagnostics and resolve when the lead installs that dependency).

Six gaps below let a materially incomplete implementation pass. Close them before the suite is locked.

## Requirement traceability

| Brief requirement | Proven by | Status |
|---|---|---|
| 1 — `@xmldom/xmldom` swap, hostile input | `dependency-manifest-policy`, `dependency-lockfile-resolution`, `existing-feed-parser-security` | Partial — see gap 1 |
| 2 — direct floors + transitive lock floors | `dependency-manifest-policy`, `dependency-lockfile-resolution` | Covered |
| 3 — removals, native `node:readline` | `dependency-manifest-policy`, `dependency-lockfile-resolution` | Partial — see gap 5 |
| 4 — audit policy and documented exceptions | `dependency-audit-exceptions-policy` | Partial — see gap 4 |
| 5 — dual-OS primary quality gate | `ci-quality-workflow` | Partial — see gaps 2, 3, 6 |
| 6 — 390 px project + axe coverage | `playwright-mobile-accessibility-wiring`, `frontend/e2e/accessibility.spec.ts` | Partial — see gap 3 |
| 7 — supply-chain gates, least privilege, SHA pins | `ci-supply-chain-workflow` | Covered |
| 8 — frozen-lock reproducibility, cache hygiene | `ci-quality-workflow`, `docker-frozen-install`, `dependency-lockfile-resolution` | Covered |
| 9 — earlier locks and existing behavior intact | Verified independently by Codex (`tdd:tests verify` on all three earlier slices) | Covered |

## Missing cases or weak assertions

### 1. An always-on warning makes both malformed-XML tests vacuously green

- Missing observable behavior: a *well-formed* document must parse with **no** malformed/parse warning. The two malformed cases accept `threw || warnings.length > 0`, and neither happy-path regression test asserts anything about `warnings`.
- Counterexample: an implementation that unconditionally runs `warnings.push("parsed with @xmldom/xmldom")` on every call passes both malformed tests and both regression tests while detecting nothing at all. The same is true of a parser that pushes a warning for every DOCTYPE, entity, or namespace it sees.
- Required assertions: (a) the two well-formed RSS/Atom regression documents produce zero warnings (or at minimum zero warnings that claim a parse/malformed problem); (b) the malformed and truncated cases, when they warn rather than throw, produce a warning whose text identifies the parse failure and is distinguishable from any warning a valid document could produce. Assert the distinguishing property, not an exact message string.
- Reference: brief requirement 1, "rejects or safely handles malformed XML … do not weaken parser tests to accept silent data corruption."

### 2. The primary quality workflow can be gated off ordinary pull requests

- Missing observable behavior: the dual-OS gate must actually execute for an ordinary pull request. `ci-quality-workflow.test.ts` checks only that the `on` mapping contains the `pull_request` and `push` keys. It never inspects job-level `if:` conditions or trigger branch/path filters. `ci-supply-chain-workflow.test.ts` has an event-condition guard, but it applies only to supply-chain jobs.
- Counterexample A: every job in the primary workflow carries `if: github.event_name == 'push'`. All step-pattern, frozen-install, browser-install, and continue-on-error assertions still pass, and no PR is ever gated.
- Counterexample B: `on.pull_request.branches: [release/**]` (or a `paths:`/`paths-ignore:` filter that excludes ordinary source changes). The `'pull_request' in on` check passes and normal PRs never run the gate.
- Required assertions: no job that contributes a required gate step may carry an `if:` condition that excludes `pull_request`; and the `pull_request` trigger must not restrict to a narrow branch allowlist or a `paths`/`paths-ignore` filter that would skip ordinary source changes. Add helper fixtures for a push-only `if:`, a narrow `branches:` allowlist, and an accepted unrestricted trigger.
- Reference: brief anti-bypass, "event conditions that keep gates from running on ordinary pull requests."

### 3. CI can run Playwright while skipping the new mobile/accessibility coverage

- Missing observable behavior: the browser gate must exercise both the desktop and the 390 px project, and must not exclude the accessibility spec.
- Counterexample: the CI step is `bun run test:e2e -- --project=chromium-desktop`, or `--grep-invert=Accessibility`, or `--ignore=**/accessibility.spec.ts`. `REQUIRED_GATE_CHECKS`'s `/playwright test|test:e2e/` pattern matches, the 390 px project exists in the config, and the mobile plus axe coverage never runs on either OS.
- Required assertions: on both OS, the Playwright step must not narrow the run with a `--project`, `--grep`, `--grep-invert`, `--ignore`, or `--shard` filter that would drop a configured project or the accessibility spec; a step that names projects explicitly is acceptable only when it names every configured project. Additionally assert that the resolved Playwright config does not exclude `accessibility.spec.ts` through `testIgnore`/`testMatch`, and that neither project sets `testIgnore` narrowing it away.
- Reference: brief requirements 5 and 6, and the anti-bypass rule against "mobile coverage from a named project that keeps a desktop viewport" — the same intent applies to a project that exists but never runs.

### 4. `dependency-review-action` alone satisfies the audit category, but never audits the existing graph

- Missing observable behavior: requirement 4 is about the **whole frozen graph** reporting zero Critical/High. `dependency-review-action` inspects only the dependencies a pull request changes; a PR touching no manifest passes trivially, and the pre-existing vulnerable graph is never examined.
- Counterexample: the supply-chain workflow contains only `actions/dependency-review-action`. `jobsMatchingCategory("dependencyReviewOrAudit")` is non-empty and every audit assertion passes, while nothing ever audits the resolved lock graph.
- Required assertions: require a full-graph audit step (a `bun audit`-family invocation) that runs in a job which also performs a frozen install, in addition to whatever change-scoped dependency review exists; and require that the audit step is a hard gate — it must not redirect or pipe its result somewhere that discards the exit status without a subsequent step that fails on Critical/High severity. Keep the existing `continue-on-error` and `|| true` guards. Do not require a specific command spelling beyond the audit family.
- Reference: brief requirements 4 and 7.

### 5. Removed packages can survive as production imports

- Missing observable behavior: no test proves the removed specifiers are gone from production source. Only `index.ts` is inspected, and only for `readline`.
- Counterexample: `package.json` drops `xmldom` and `readline` while a production module still does `import { DOMParser } from "xmldom"` or `import readline from "readline"`. Every manifest and lock assertion passes; the failure surfaces only at runtime.
- Required assertion: no non-test production source file (root `*.ts`/`*.tsx` outside `tests/`, `frontend/e2e/`, and `node_modules/`) imports or requires the bare `xmldom`, bare `readline`, `bun-types`, or `@types/xml`/`@types/xmldom` specifiers. Bare `node:readline` and `@xmldom/xmldom` remain valid. Cover both `import` and `require` forms in helper fixtures.
- Reference: brief requirements 1 and 3.

### 6. Windows steps are not held to cross-platform shell syntax

- Missing observable behavior: requirement 5 states "Commands must be non-interactive and work on both shells." Nothing checks the `windows-latest` steps for POSIX-only constructs — the exact defect class the accepted `p1-cross-platform-e2e-launch` slice already fixed once in the Playwright launcher.
- Counterexample: the Windows job runs `cd frontend && export CI=1 && bun run test`, or uses `$(pwd)`, a `<<EOF` heredoc, or `rm -rf`. Every step-pattern assertion matches and the Windows job fails on the runner.
- Required assertions: for every step in a job whose effective `runs-on` includes `windows-latest` and which does not declare an explicit POSIX `shell:` (`bash`/`sh`/`pwsh` handled per its own semantics), reject POSIX-only constructs — `export VAR=`, `$(...)` command substitution, heredocs, `rm -rf`, `2>/dev/null`, and single-quoted argument quoting that PowerShell would not interpret identically. Add helper fixtures for one offending and one portable step so the predicate itself is exercised.
- Reference: brief requirement 5 and the accepted `p1-cross-platform-e2e-launch` contract.

## Test correctness

- [x] RED is caused by missing behavior, not setup/import/environment failure. Independently reproduced: 63 pass / 65 fail over the eight backend files. Failures decompose as 13 manifest floors/removals, 7 lock resolutions, 2 missing policy document, 20 missing primary quality workflow, 14 missing supply-chain workflow, 1 Docker frozen install, 6 Playwright mobile/axe wiring, 2 parser malformed-input.
- [x] Existing behavior is not accidentally weakened. All three earlier locks verify unchanged.
- [x] Assertions are semantic and specific; no snapshots.
- [x] Fixtures are deterministic and contain no secrets; no network dependency in the unit layer.
- [x] No `.only`/`.skip`/`.todo`.
- [x] Tests do not over-constrain a valid implementation — coverage is identified by role, not by workflow filename or document format beyond the one deliberately pinned policy contract.
- [x] Claude changed test/fixture files only.

Two notes that are **not** defects and must be preserved:

- The XXE, SSRF-DOCTYPE, and billion-laughs cases pass today. They are legitimate regression locks proving the parser swap does not introduce entity dereferencing. Keep them.
- The 2 s wall-clock bounds on the SSRF and entity-expansion cases use a deliberately non-routable address so that a real dereference would hang rather than fail fast. Keep that reasoning; do not tighten the bound into flakiness.

## Feedback for Claude

Revise the same nine test files to close gaps 1–6. Change tests only; do not implement production code.

- Gap 1 belongs in `tests/existing-feed-parser-security.test.ts`.
- Gaps 2, 3, and 6 belong in `tests/ci-quality-workflow.test.ts`, except the config-side half of gap 3 (`testIgnore`/`testMatch` exclusion of the accessibility spec), which belongs in `tests/playwright-mobile-accessibility-wiring.test.ts` using the same subprocess config loader already in that file.
- Gap 4 belongs in `tests/ci-supply-chain-workflow.test.ts`.
- Gap 5 belongs in `tests/dependency-manifest-policy.test.ts`.

Every new predicate needs its own helper-correctness fixtures, matching the style already used in this suite. Preserve all existing adversarial fixtures and every currently genuine RED. Do not edit the ten locked files from the earlier three slices or `frontend/e2e/fixtures.ts`.

Re-run only the eight backend slice files (`bun test tests/dependency-manifest-policy.test.ts tests/dependency-lockfile-resolution.test.ts tests/dependency-audit-exceptions-policy.test.ts tests/ci-quality-workflow.test.ts tests/ci-supply-chain-workflow.test.ts tests/docker-frozen-install.test.ts tests/playwright-mobile-accessibility-wiring.test.ts tests/existing-feed-parser-security.test.ts`) and report the revised RED breakdown per file, plus any genuine remaining limitation.

## Round 2 scrutiny

`ACCEPTED FOR IMPLEMENTATION`

- Claude Code Sonnet 5 session: `86ea0a94-339e-4b03-8735-75ab60102d7c` (same session; `revise` resumed it).
- Independent Codex command: the same eight backend slice files.
- Independent result: **113 pass / 75 fail / 188 tests / 340 assertions**, matching Claude's report exactly.

All six gaps are closed, each with its own helper-correctness fixtures:

1. **Always-on warning loophole** — both well-formed regression documents now assert `warnings` is exactly `[]`, and the malformed/truncated cases require a warning that identifies the parse failure. The zero-warning lock, not the keyword predicate, is what defeats an adversarial message; the suite documents that reasoning honestly rather than pretending the predicate is the defense.
2. **PR-skipping event conditions** — `pullRequestTriggerIsUnrestricted` rejects a `branches` allowlist and `paths`/`paths-ignore` narrowing on `on.pull_request`; `jobConditionExcludesPullRequest` rejects a job `if:` that excludes the event while correctly accepting an OR'd condition that still includes it.
3. **Playwright narrowing** — CI side rejects `--grep`, `--grep-invert`, `--ignore`, `--shard`, and any `--project` list that does not name every project loaded from the real config; config side proves `accessibility.spec.ts` survives top-level and per-project `testIgnore`/`testMatch`.
4. **Change-scoped review is no longer sufficient** — `fullGraphAudit` matches only `step.run`, so `dependency-review-action` (which has no `run`) structurally cannot satisfy it. The audit must additionally co-locate with a root frozen install and be a hard gate; `auditStepIsHardGate` rejects a discarding pipe/redirect without a severity-checking follow-up and correctly does not misread `||` as a pipe.
5. **Removed packages surviving as imports** — a recursive scan of root production `.ts`/`.tsx` (excluding `frontend`, `node_modules`, `public`, `tests`) rejects bare `xmldom`, `readline`, `bun-types`, `@types/xml`, `@types/xmldom`, with negative fixtures for `node:readline` and `@xmldom/xmldom`. It found the two genuine violations.
6. **Windows POSIX-only constructs** — `usesPosixOnlyConstruct` flags `export VAR=`, `$(...)`, heredocs, `rm -rf`, and `2>/dev/null` on any `windows-latest` step without an explicit `bash`/`sh` shell, and does not false-positive on a `${{ }}` expression.

Revised RED decomposition, all traceable to still-absent production behavior: manifest 15, lockfile 7, audit-exceptions policy 2, primary quality workflow 25, supply chain 17, Docker 1, Playwright wiring 6, parser 2.

Accepted residuals, deliberate and recorded rather than returned:

- `globToRegExp`, `playwrightStepNarrowsCoverage`, and `usesPosixOnlyConstruct` are scoped heuristics covering the named bypasses, not full glob/shell parsers. Appropriate for an architecture guard.
- `pullRequestTriggerIsUnrestricted` rejects any `branches` key on `pull_request`. Marginally stricter than necessary, but it matches the release policy and does not block a conforming implementation.
- `fullGraphAudit` matches only the `bun audit` family. Correct for a Bun-only repository.
- The three cascading failures inside the locked static suites are the single `Cannot find module '@axe-core/playwright'` diagnostic and resolve when the lead installs that dependency.

The nine Claude-owned test files are accepted without Codex modification and are ready to lock.

## Round 3 scrutiny

`RETURN TO CLAUDE`

Rounds 1 and 2 are closed — every gap listed above stays closed, and the implementation is complete and GREEN on the accepted suite (188 pass / 0 fail). One item remains, and it is the lead's to report rather than fix, because it lives in Claude-owned test files.

### The new test files exceed the locked static-diagnostics ceiling

Brief requirement 9 states the earlier ten-file static acceptance suite must remain intact. The accepted `p1-static-diagnostics-cleanup` lock caps aggregate Biome output at **545 warnings / 13 infos**. The current tree produces **547 warnings / 14 infos**, so two locked assertions fail:

```
tests/static-diagnostics-cleanup-architecture.test.ts
  aggregate lint warnings do not exceed the pre-fix baseline   Expected: <= 545   Received: 547
  aggregate lint infos do not exceed the pre-fix baseline       Expected: <= 13    Received: 14
```

All three excess diagnostics originate in this slice's own new test files. No production file contributes any new diagnostic; the full backend suite is otherwise 993 pass / 2 fail, with those two ceiling assertions as the only failures.

- `tests/ci-quality-workflow.test.ts:507` and `:508` — `lint/suspicious/noTemplateCurlyInString` (2 warnings). These are the deliberately literal `${{ }}` GitHub Actions fixtures inside the `usesPosixOnlyConstruct` helper-correctness block. The file already has the correct pattern for this at line 136, where `MATRIX_OS_REF` carries a `// biome-ignore lint/suspicious/noTemplateCurlyInString:` comment explaining that the text must stay literal. Apply the same treatment to these two fixtures — either hoist them into named constants with that ignore comment, or annotate them in place. Keep the strings literally `${{ ... }}`; converting them to real template literals would destroy what the fixture is testing.
- `tests/ci-supply-chain-workflow.test.ts:169` — `lint/style/useTemplate` (1 info). `"actions/dependency-review-action@" + "a".repeat(40)` should be a template literal, matching the style already used at line 106 (`` `actions/checkout@${"a".repeat(40)}` ``).

These are formatting-only corrections. Do not change any assertion, predicate, fixture value, or the set of covered behaviors — the suite's semantics must be byte-for-byte equivalent in effect, and all 188 tests must still pass against the now-implemented production code.

Change only those two files. Then run both the eight backend slice files and `tests/static-diagnostics-cleanup-architecture.test.ts`, and report both results.

## Round 4 scrutiny

`RETURN TO CLAUDE`

The backend suite is fully green (`bun run verify:core`: 0 lint errors at exactly the locked 545/13 ceiling, 0 typecheck errors, 995 pass / 0 fail, catalog validated, build succeeded). The browser suite is not, and three of the four failures classes are test defects rather than production gaps.

`bun run test:e2e` on Windows: **16 passed, 16 failed** across the two projects.

### 1. Accessibility route paths drop the `/public/` base

Three of the four axe tests never reached `AxeBuilder` at all — they timed out in `waitForReady`:

```
My Feeds  getByRole('heading', { name: 'Feeds', exact: true })   element(s) not found
Settings  getByText('Security', { exact: true })                 element(s) not found
Health    getByRole('heading', { name: 'Health Dashboard' })     element(s) not found
```

The cause is the leading slash in `ROUTES[].path`. `frontend/playwright.config.ts` sets `baseURL: 'http://localhost:5173/public/'`, and an absolute path replaces the whole base path: `page.goto('/feeds')` resolves to `http://localhost:5173/feeds`, not `http://localhost:5173/public/feeds`. `feeds.spec.ts` already proves the `Feeds` heading locator itself is correct on desktop, so the locators are not the problem — the URLs are.

- Required correction: make every route path resolve under the configured `baseURL`. Then confirm each `waitForReady` locator against the real rendered page rather than inferring it, and confirm each route reaches `analyze()`.
- Do not work around this by removing `waitForReady`, by lengthening timeouts, or by dropping a route from `ROUTES`. All four routes are required by brief requirement 6.

### 2. The failure message needs the violating nodes

The message names the route, project, rule, impact, and node count, but not *which* elements failed. That is not enough for the lead to act on a real violation without re-running with ad-hoc instrumentation.

- Required correction: include each violating node's target selector (and, where short, its failure summary) in the thrown message, bounded so a large violation set stays readable.
- Reference: brief requirement 6, "include a useful route/project failure message."

### 3. The pre-existing specs do not work under the 390 px project

Eight `chromium-mobile-390` failures come from `basic.spec.ts`, `feeds.spec.ts`, `health.spec.ts`, and `settings.spec.ts`, all failing the same way:

```
locator.click: Test timeout of 30000ms exceeded.
  waiting for getByRole('link', { name: 'Settings', exact: true })
```

This is correct application behavior, not a regression. The desktop sidebar is `lg:`-gated, and below that breakpoint `frontend/src/components/layout/BottomNav.tsx` renders only **My Feeds**, a **Build Feed** button, and **Catalog** — there is no Settings or Health link at 390 px by design.

Adding the 390 px project is this slice's production change, so this slice owns making the browser suite honest under it.

- Required correction: make these specs reach their pages in a way that is valid at both widths — navigate directly to the route where no mobile nav entry exists, and where a mobile nav entry does exist, prefer exercising it so the mobile navigation is genuinely covered. Keep the desktop navigation assertions that exist today; do not delete desktop coverage to make mobile pass.
- Do not solve this with a per-project `testIgnore`/`testMatch` that excludes these specs from the mobile project, with `test.skip` on mobile, or by widening the mobile viewport. Any of those would reproduce exactly the "named project that does not really run" bypass the accepted suite already forbids.

### 4. One genuine production violation — leave it RED

On the Builder route the axe scan did run and found a real defect:

```
Route 'Builder (application shell + /)' (/) on project 'chromium-desktop' has 1 serious/critical accessibility violation(s):
  - [serious] color-contrast: Elements must meet minimum color contrast ratio thresholds (8 node(s))
```

This is a production CSS problem and the lead owns fixing it. Do not exclude the rule, lower the impact threshold, scope the scan away from those nodes, or otherwise soften the gate. Item 2 above exists so the lead can identify the eight nodes.

### Verification note

Playwright's Chromium is now installed locally, so this round can and must be verified by actually running the browser suite — the execution limitation recorded in earlier rounds no longer applies.

Change only files under `frontend/e2e/`. Run `bun run test:e2e` from the repository root and report the per-project result. The four Builder-route colour-contrast failures are expected to remain RED until the lead's CSS fix lands; every other browser test must pass on both projects. Then re-run the eight backend slice files and `tests/static-diagnostics-cleanup-architecture.test.ts` to confirm neither regressed.

## Round 5 scrutiny and final acceptance

`ACCEPTED`

Round 4 and round 5 deltas are recorded in `p1-dependency-ci-security-baseline-review-round4.md` and `-round5.md` (split out because the accumulated review file overflowed the Windows command-line limit the launcher passes the prompt through).

Round 5 closed the last two test defects. The accessibility spec now reaches every route by a real in-app click from the authenticated start page, never by `page.goto()` to a client route. All four routes are scanned on the desktop project. On the 390 px project, Builder and My Feeds are scanned and Health and Settings are dynamically skipped with a specific reason naming the owning packet. No rule exclusions, no impact-threshold lowering, no per-project `testIgnore`/`testMatch`, no widened mobile viewport, and no desktop coverage was dropped.

One correction I owe the record: my round-4 instruction to navigate directly to routes without a mobile nav entry was wrong, because the application has no SPA deep-link fallback. I should have verified that before asking. Round 5 corrected it.

### Final independent verification

- Accepted slice suite, eight backend files: **188 pass / 0 fail**.
- `bun run verify:core`: lint **0 errors, 545 warnings, 13 infos** — exactly the locked `p1-static-diagnostics-cleanup` ceiling; typecheck **0 errors** across root and frontend; `bun test tests/` **995 pass / 0 fail**; Community Catalog validated; production build succeeded.
- `bun run test:e2e` on Windows, both projects: **24 passed, 8 skipped, 0 failed**. The eight skips are the four Health/Settings mobile cases in `accessibility.spec.ts`, `health.spec.ts`, and `settings.spec.ts`, each carrying an explicit unreachable-at-390 px reason.
- `bun audit --audit-level=high`: clean. No Critical or High advisory in the resolved graph.
- All four test locks verify unchanged.

### Production defects this slice found and fixed

- `--muted-foreground` at `204 9% 47%` measured 4.03:1 on `--muted`, 4.22:1 on `--background`, and 4.41:1 on white — all below the 4.5:1 AA threshold — and it carries the sidebar and bottom-nav labels. Now `42%` (4.85 / 5.07 / 5.31).
- `SettingRow.tsx` dimmed the whole env-managed row with `opacity-60`. That blends text and badge backgrounds toward the card together, so no opacity below 1.0 can clear AA; it produced 15 serious nodes. Removed. Read-only status is still stated explicitly by the "ENV" and "Env-managed" badges, which `settings.spec.ts` asserts.
- `--wb-warning` (`#8c7f50`) is a fill tone being used as 10 px text on its own 15 % tint: 3.37:1, and 3.99:1 on white. Added `--wb-warning-ink: #695f3c` (5.13:1 / 6.34:1) and used it for the badge text, leaving fills and health dots unchanged.

### Product gaps found, recorded rather than patched

Both are outside Packet 1's infrastructure-only scope and are carried to the ledger:

- **No SPA deep-link fallback.** `index.ts` serves `/public/*` through `serveStatic` and maps only `GET /` to `index.html`, and `vite.config.ts` proxies `/public` to it. Refreshing or bookmarking any page but the root returns a bare 404. Packets 2 and 3 own `index.ts` routing and static mounts.
- **Health and Settings are unreachable at 390 px.** `Sidebar.tsx` is the only place linking them and is `lg:`-gated; `BottomNav.tsx` exposes only My Feeds, Build Feed, and Catalog. Packet 4 / the UI Redesign Correction Pass owns this.

Same-class residual risk: `--wb-warning` is still used as text in `SourceAssistantPanel.tsx` and `MyFeedsPage.tsx`. Those routes pass axe today, but the packets owning those files should move that text to `--wb-warning-ink`.
