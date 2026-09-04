# Mkfd v3 implementation ledger

This is the single execution-status record for `docs/mkfd-v3-implementation-roadmap.md`. Keep evidence compact; do not paste Claude transcripts or duplicate feature-readiness prose here.

## Status meanings

- **Not started:** no implementation slice has begun.
- **In progress:** at least one slice is active or complete, but packet exit criteria are not met.
- **Blocked:** an explicit dependency or product decision prevents progress.
- **Verification:** implementation is complete and packet-wide exit checks are running.
- **Ready:** packet exit criteria have passed with linked evidence.

## Packet status

| Packet | Owner | Status | Active slice | Exit evidence | Outstanding risk |
|---|---|---|---|---|---|
| 0 — Scope/documentation lock | Codex | Ready | — | ADR 0001; 31/31 feature specs and plans; evidence-based `PROGRESS.md`; source/decision consistency check | None; replacement decisions require a new approved ADR |
| 1 — Quality/dependency baseline | Codex | Verification | — | All four slices GREEN; `verify:core` green; Windows `test:e2e` 24 pass / 8 reasoned skips / 0 fail; `bun audit --audit-level=high` clean; dual-OS `quality.yml` and SHA-pinned `supply-chain.yml` added | Dual-OS CI and clean-install reproducibility are structurally asserted but not yet observed on a real GitHub runner; `tdd:claude` launcher has two known defects |
| 2 — Trust boundary/security | Codex | Not started | — | — | Critical authentication and secret-handling findings remain open |
| 3 — Runtime/config/network platform | Codex | Not started | — | — | Critical shared contracts are not frozen |
| 4 — Frontend platform/My Feeds | Codex | Not started | — | — | Depends on Packets 2–3 contracts |
| 5 — Builder contract/parity | Codex | Not started | — | — | Depends on Packets 2–3 contracts |
| 6 — Source Assistant/web intelligence | Codex | Not started | — | — | Depends on Packets 3–5 |
| 7A — Remote sources | Codex | Not started | — | — | Depends on shared runtime/UI contracts |
| 7B — Ingress/local sources | Codex | Not started | — | — | Depends on shared runtime/UI contracts |
| 8 — Templates/catalog | Codex | Not started | — | — | Depends on protected values and config contract |
| 9 — Service connectors | Codex | Not started | — | — | Depends on source registry and outbound executor |
| 10 — Release proof | Codex | Not started | — | — | All earlier packets |

## TDD slice evidence

Add one row when a slice begins. Update the same row through RED, scrutiny, GREEN, and broader verification.

| Slice | Packet / findings | Requirements brief | Claude Sonnet 5 session | Accepted test files | RED evidence | GREEN evidence | Broader verification | Commit/PR | Migrations / remaining risk |
|---|---|---|---|---|---|---|---|---|---|
| `p0-scope-lock` | Packet 0 | Documentation-only governance bootstrap; no production behavior | Not applicable | Not applicable | Not applicable | Not applicable | Document consistency review | Working tree | Must be Ready before Packet 1 production changes |
| `p1-cross-platform-e2e-launch` | Packet 1 / C12, H3 | `docs/tdd/p1-cross-platform-e2e-launch.md` | `2dde5c4a-ceb9-40cb-88ca-8e9fbd7b77eb` (`claude-sonnet-5`) | `tests/e2e-harness-config.test.ts`; `frontend/e2e/fixtures.ts` | 17 pass / 19 intended fail after fixture handoff | 36 pass / 0 fail; accepted hashes verified | Windows `bun run test:e2e`: 12/12 pass; targeted Biome pass | Working tree | Production auth hardening remains Packet 2 scope |
| `p1-static-quality-contract` | Packet 1 / C3, H2 | `docs/tdd/p1-static-quality-contract.md` | `5841fa29-90ea-4297-9594-1eb398e4d3d8` (`claude-sonnet-5`) | `tests/static-quality-scripts.test.ts`; `tests/static-quality-biome-config.test.ts`; `tests/static-quality-typescript-config.test.ts`; `frontend/e2e/fixtures.ts` | Final accepted RED: 85 pass / 54 intended fail | 139 pass / 0 fail; accepted hashes verified | Targeted Biome on 8 changed test/production files: zero warnings/errors; prior E2E 36/36 | Working tree | Exact Biome 2.5.11 / TypeScript 5.7.3 pins and both lockfiles updated; application diagnostics intentionally move to the next slice |
| `p1-static-diagnostics-cleanup` | Packet 1 / C3, H2 | `docs/tdd/p1-static-diagnostics-cleanup.md` | `801db20e-5c32-44bd-a095-a77a7184ef7f` (`claude-sonnet-5`) | `tests/static-diagnostics-cleanup-architecture.test.ts`; `tests/static-diagnostics-cleanup-anti-bypass.test.ts`; `tests/frontend-accessibility-semantics.test.ts`; `tests/frontend-hook-dependency-safety.test.ts`; `tests/regex-and-callback-correctness-preservation.test.ts`; `tests/protected-value-cast-boundary.test.ts` | Final accepted RED: 354 pass / 15 intended fail / 369 tests | 369 pass / 0 fail / 714 assertions; accepted hashes verified | Aggregate lint/typecheck green (545-warning/13-info cap preserved); 133/133 related runtime tests; production build succeeds | Working tree | Maintained declaration packages added; request-profile/selector/webhook type drift corrected; Selector Playground and FlareSolverr retained; warning-only debt remains owned by later packets |
| `p1-dependency-ci-security-baseline` | Packet 1 / B4, H1-H3, S7, S10 supply-chain | `docs/tdd/p1-dependency-ci-security-baseline.md` | `86ea0a94-339e-4b03-8735-75ab60102d7c` (`claude-sonnet-5`) | `tests/ci-quality-workflow.test.ts`; `tests/ci-supply-chain-workflow.test.ts`; `tests/dependency-audit-exceptions-policy.test.ts`; `tests/dependency-lockfile-resolution.test.ts`; `tests/dependency-manifest-policy.test.ts`; `tests/docker-frozen-install.test.ts`; `tests/existing-feed-parser-security.test.ts`; `tests/playwright-mobile-accessibility-wiring.test.ts`; `frontend/e2e/accessibility.spec.ts` | Round 1: 63 pass / 65 intended fail. Final accepted RED: 113 pass / 75 intended fail | 188 pass / 0 fail on the accepted suite; accepted hashes verified | `verify:core` green (lint 0 errors at the locked 545/13 ceiling; typecheck 0 errors; 995/995 tests; catalog validated; build succeeded); Windows `test:e2e` 24 pass / 8 reasoned skips / 0 fail across both projects; `bun audit --audit-level=high` clean | Working tree | 5 review rounds. Fixed 3 real contrast defects (`--muted-foreground`, `SettingRow` row opacity, new `--wb-warning-ink`). Two product gaps recorded, not patched: no SPA deep-link fallback (Packets 2-3) and Health/Settings unreachable at 390 px (Packet 4). `--wb-warning` still used as text in `SourceAssistantPanel`/`MyFeedsPage` |

## Baseline

- Branch: `major-revision-0526`
- Reviewed baseline: `c8a54df`
- 2026-09-02 `bun run verify:static`: failed during Biome lint with 71 errors and 387 warnings; typecheck did not run because lint failed.
- TDD launcher evidence: Claude Code 2.1.258 is callable; argument, Sonnet 5 identity, path-boundary, same-session revision, and slice-test-lock enforcement have all run against live slices.

## Carried findings (raised by Packet 1, owned elsewhere)

| ID | Finding | Evidence | Owner packet |
|---|---|---|---|
| CF-01 | No SPA deep-link fallback. `index.ts` serves `/public/*` through `serveStatic({ root: "./" })` and maps only `GET /` to `index.html`; `frontend/vite.config.ts` proxies `/public` to that backend. Refreshing or bookmarking any client route returns a bare `404 Not Found`. | `page.goto('feeds'\|'health'\|'settings')` renders `404 Not Found` in the browser suite; forced `accessibility.spec.ts` to navigate by in-app clicks only. | 2, 3 |
| CF-02 | Health and Settings have no navigation entry point at 390 px. `Sidebar.tsx` is the only place linking `/health` and `/settings` and is `lg:`-gated; `BottomNav.tsx` exposes only My Feeds, Build Feed, and Catalog. | Eight explicitly-reasoned mobile skips in `accessibility.spec.ts`, `health.spec.ts`, `settings.spec.ts`. | 4 |
| CF-03 | `--wb-warning` (`#8c7f50`) is a fill tone still used as text in `SourceAssistantPanel.tsx` and `MyFeedsPage.tsx`. As small text it measures 3.37:1 on its own 15 % tint and 3.99:1 on white. `--wb-warning-ink` (`#695f3c`) now exists for this; those call sites were left to their owning packets. | Same defect class as the fixed `SettingRow` badge. Those routes pass axe today. | 4, 6 |
| CF-04 | `tdd:claude` launcher, two defects hit during this slice. (1) When it throws after Claude responds, the session-state file is never written and the session ID is orphaned — recovered here from `-last-response.json`. (2) It passes the whole prompt as a single process argument, so a long feedback file fails on Windows with `ENAMETOOLONG` — worked around by splitting per-round delta feedback files. | Both reproduced in this slice. | 1 follow-up slice |
