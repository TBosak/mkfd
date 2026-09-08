# Acceptance review — `p3-browser-adapter`

**Verdict: accepted after one revise round.** Locked 2026-09-08.

Session `1396d245-026c-4baf-a6e5-1b5a20b07a6a` (`claude-sonnet-5`), author pass
136 turns, revise pass 38 turns. A first revise attempt was cut by a session
limit after 24 turns having landed no edits; it was relaunched once the limit
reset, in the same session.

## Locked files (7)

| File | Tests |
|---|---|
| `tests/browser-adapter.test.ts` | 29 |
| `tests/browser-adapter-static-guard.test.ts` | 17 |
| `tests/browser-adapter-data-handler.test.ts` | 6 |
| `tests/browser-adapter-preview-generator.test.ts` | 6 |
| `tests/browser-adapter-worker.test.ts` | 2 |
| `tests/helpers/fake-browser.ts` | harness |
| `tests/helpers/browser-adapter-worker-preload.ts` | harness |

The two helpers are locked deliberately. `fake-browser.ts` is a behavioural
stand-in, not a fixture — it decides what a route verdict is and when a
navigation resolves — so leaving it unlocked would let an implementation pass by
weakening the harness rather than the assertions, without breaking any lock.

## RED reproduced independently

Not taken from the author's report. Measured by the lead, after killing stray
:5000/:5173 listeners by PID:

| File | Result |
|---|---|
| `browser-adapter` | 0 pass / 1 fail / 1 error (module does not exist yet) |
| `browser-adapter-static-guard` | 6 pass / 10 fail |
| `browser-adapter-data-handler` | 3 pass / 3 fail |
| `browser-adapter-preview-generator` | 2 pass / 4 fail |
| `browser-adapter-worker` | 1 pass / 1 fail |

Each failure is attributable to this slice: at every call site the author chose a
case that specifically defeats that site's *existing* pre-slice validation — a
scraped-in private mid-chain URL, a redirect to a private address after the
one-shot `baseUrl` pre-check, a private subresource — rather than a case already
covered elsewhere.

## Review round 1 — two defects returned

**1. Eight Biome errors.** The sandbox denied the author `lint`/`biome` on every
attempt, the fourth consecutive slice with that denial pattern; it said so
plainly and asked the lead to check. Six formatter, two import-sort, no semantic
defect — but the gate demands zero errors. Fixed; `bunx biome check` on all seven
files now reports no errors.

**2. The static guard could pass vacuously.** `scanForHits()` returned `[]` both
when the code was clean and when it had walked nothing, because `listTsFiles`
swallows a failed `readdirSync`. A renamed directory or a path-separator problem
on the other OS would have turned the strongest assertion in this slice into a
permanently green test proving nothing — and a green guard invites nobody to
look. Fixed with a `scan non-vacuity` block: every scanned directory must yield
at least one `.ts` file, and the total must be a plausible size for the codebase.

**Verified, not trusted.** A scratch copy of the guard with `SCAN_DIRS` pointed
at four nonexistent directories was run in the same directory (so `REPO_ROOT`
resolved identically) and both new tests failed as designed; the probe was then
deleted. The locked file itself was never edited.

Also corrected: a `describe` title reading "the four named call-site files" over
an array of three paths — `data-handler.utility.ts` carries two of the four
*sites* but is one *file*.

## Rulings recorded

- **`_launchBrowser` accepted** — it mirrors the existing `_dnsLookupFn` /
  `_skipDns` convention on `OutboundFetchPolicyOptions`, so it is a project idiom
  rather than a new test affordance, and the adapter's own suite needs per-test
  launch control that whole-file module mocking cannot give cleanly. The author
  raised it as an open question instead of sliding it in.
- **The drill-chain cookie gap stays out of scope**, filed as CF-14.
  `resolveDrillChain`'s advanced branch ignores its `cookies` parameter while the
  preview and worker branches apply theirs. Closing it would change which hosts
  receive a user's session cookie — a live behaviour change dressed as a
  refactor. The author flagged rather than fixed it, which was right.

## Notes carried into implementation

- No real Chromium is launched anywhere; `mock.module("patchright")` plus an
  injected factory. The worker suite mocks inside the spawned thread via a
  `preload` script, because a parent-thread `mock.module` cannot reach a real
  worker's module registry.
- The adapter needs no static-guard exemption: `lib/outbound/browser-adapter.ts`
  sits outside all four scanned directories, the same reason the FlareSolverr
  guard needs no ledger entry for its own adapter.
- The guard also forbids `as any` and the literal string `as unknown as`
  anywhere in the adapter file, comments included — that has cost two slices.
- Behaviour the suite pins as load-bearing: the `navigator.webdriver` init
  script, the random user agent, per-feed headers, cookie injection with a
  hostname-derived domain, and the deliberate "networkidle timed out, use the
  current page state" tolerance, which is separated from a genuine policy refusal
  so the migration cannot collapse the two.
