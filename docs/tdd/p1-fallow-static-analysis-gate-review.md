# Test Scrutiny Review: `p1-fallow-static-analysis-gate`

## Verdict

`RETURN TO CLAUDE`

Strong first draft. Independent RED reproduction: **98 pass / 28 fail** across the four files, decomposing exactly as reported (14 / 11 / 3 / 0). The suite cross-checks against the real fallow oracle rather than only reasoning about config text, unit-tests every helper predicate, proves the entry-point mechanism actually changes the result rather than merely asserting the current state, distinguishes exit 1 from exit 2, holds suppression comments at zero, and bars the dead adapters from being recorded as exceptions. The `buildStarterConfig` behavior lock covering all nine route types is exactly what makes the adapter deletion provable rather than assumed.

One gap must close before lock.

## 1. The undeclared-import check is scoped to the instance, not the class

`extractBareImportSpecifiers` and `packageNameFromSpecifier` are general and well unit-tested, but the assertion at line 608 only ever asks about `domhandler`. The stated reason is real — the repo has bare `crypto`, a virtual `bun` module, and `libmime` — but the effect is that the defect class stays open.

- Missing observable behavior: a **new** undeclared bare import of any package must fail. Today only a new `domhandler` import would.
- Counterexample: a future edit adds `import { parseDocument } from "htmlparser2"` to a production file. `htmlparser2` is hoisted via cheerio exactly like `domhandler` was, is absent from the root manifest, and every test in this suite still passes. That is the identical defect this slice exists to close, one package over.
- Required assertion: sweep every bare specifier in root production source and require each resolved package name to be declared in the root manifest, with three explicit carve-outs — Node built-ins (both `node:`-prefixed and bare, e.g. `crypto`, `fs`, `path`), Bun's virtual `bun` module, and a **named, commented allowlist** of the known pre-existing offenders such as `libmime`. The allowlist must be a literal list of package names, never a pattern, so adding to it is a visible, reviewable act. Assert the allowlist stays at its authoring size, so it cannot silently absorb new violations.
- Reference: brief requirement 3, "no production source file imports a package that is absent from the manifest," and the product decision to fix the cause rather than the instance.

Keep the existing `domhandler`-specific manifest, oracle, and version-floor tests; this is an addition, not a replacement.

## 2. Align the review window with its sibling document

`ONE_RELEASE_CYCLE_DAYS = 120` is a defensible reading of an undefined term, and documenting it was right. But `docs/security/dependency-audit-exceptions.md` — the document this one deliberately mirrors — uses roughly 90 days. Two exception documents in the same repo with different expiry horizons is a papercut for whoever maintains them.

- Required change: set the bound to 90 days and keep the assumption comment, noting it matches the sibling document.

## Test correctness

- [x] RED is caused by missing behavior, not setup or import failure. Verified independently.
- [x] Existing behavior is not weakened. `starter-configs.test.ts` was extended only; it passes 18/18 today and locks all nine route types before the adapters are deleted.
- [x] Assertions are semantic; no snapshots.
- [x] Fixtures are deterministic; the fallow oracle is invoked in-process and cached.
- [x] No `.only`/`.skip`/`.todo`.
- [x] Claude changed test files only.

The launcher's boundary check reported `feed-state/filesystem/filesystem-test.json` as an out-of-boundary edit and aborted. That is **not** a Claude violation: it is CF-05, the test suite rewriting tracked runtime state, tripping the CF-04 abort path. The file was restored and the session state reconstructed from the response record. The two findings are causally linked and should be fixed together.

## Feedback for Claude

Revise `tests/fallow-static-analysis-gate.test.ts` for gap 1 and `tests/static-analysis-exceptions-policy.test.ts` for gap 2. Tests only; no production code. Preserve every existing assertion and all 28 genuine RED failures — gap 1 should add failures only if it finds a real undeclared import beyond `domhandler`, which it should not.

Run the same four files and report the revised RED breakdown per file.

## Round 2 scrutiny and acceptance

`ACCEPTED FOR IMPLEMENTATION`

- Claude Code Sonnet 5 session: `db3144a2-e11c-47c2-b781-40c77e7413f2` (same session).
- Independent result: **103 pass / 29 fail** across the four files, matching the report (15 / 11 / 3 / 0).

Both gaps closed. The undeclared-import check is now a general sweep of root production source with `isNodeOrBunBuiltin` excluding Node built-ins and Bun's `bun`/`bun:*` virtual modules, a literal `PRE_EXISTING_UNDECLARED_IMPORT_ALLOWLIST = ["libmime"]` whose size is locked at 1, and a sanity test asserting the current violation set is exactly `{"domhandler"}`. A future hoisted import such as `htmlparser2` would now fail. The exceptions horizon is 90 days, matching the sibling dependency-audit document.

The single new failure is the general sweep firing on the three known `domhandler` call sites — no new package flagged, confirming the sweep is correctly scoped rather than noisy.

Interpretive assumptions I am accepting as the binding contract, since tests cannot change after lock: the exceptions document uses a fenced ```json array of records with fields `path`, `findingType`, `owner`, `rationale`, `reviewBy`; `owner` is formatted `Packet <n>` or `V2-<n>`; and "one release cycle" means 90 days.

## Round 3 scrutiny and acceptance

`ACCEPTED FOR IMPLEMENTATION`

Round 3 was driven by a product-direction change (Amendment 1 in the brief), not by a defect. Delta feedback in `p1-fallow-static-analysis-gate-review-round3.md`.

- Claude Code Sonnet 5 session: `db3144a2-e11c-47c2-b781-40c77e7413f2` (same session throughout).
- Independent result: **21 RED** — `fallow-static-analysis-gate` 77/8, `fallow-analyze-script-and-ci-workflow` 19/10, `static-analysis-exceptions-policy` 13/3, with `starter-configs` 18/0 and the new `fallow-circular-dependency-behavior` 29/0 green as safety nets. Matches the report exactly.

What closed:

- `ROADMAP_PENDING_PATHS` is split into `PROTECTED_CITED_PATHS` (5, each carrying a V2 id or owning packet) and `MUST_DELETE_MODULES` (6, each with an import marker so "nothing references it" is proven rather than asserted). Claude independently re-verified my classification instead of taking it on trust.
- The `--ci` versus `--fail-on-issues` distinction is now proven empirically by spawning both against this repository's real findings, rather than trusting the documented equivalence. `scripts.analyze` must use `--fail-on-issues` specifically. This matters: `--ci` exits 0 with 82 findings present, so the earlier contract would have accepted a gate that gated nothing.
- CI retargeted to `fallow audit`, with anti-bypass for `--gate all` and for a self-referential `--changed-since`/`--base` that would diff a ref against itself.
- The exceptions cross-check is relaxed correctly: a currently-unused file is satisfied by either a record or membership in the cited protected list, with a sanity test proving the relaxation is not vacuous.
- A new behavior lock covers the five exports crossing the `data-handler` ↔ `rss-builder` cycle, so the untangling is provable rather than assumed.

Judgment calls I am accepting:

- `--gate` is constrained to `new-only`. Fallow offers only `new-only` and `all`, and `all` measurably fails on pre-existing findings in touched files, which contradicts Amendment 1.A. Correct reading.
- Claude corrected one of its own earlier assertions that had gone stale because I implemented entry points, `domhandler`, and the adapter deletions between rounds. It rewrote a hardcoded pre-fix snapshot into a timeless invariant rather than leaving a false failure. Right call, and it reported it rather than doing it silently.

## Round 4 scrutiny and acceptance

`ACCEPTED FOR IMPLEMENTATION`

- Session `db3144a2-e11c-47c2-b781-40c77e7413f2`. Independent result: **11 RED** — `fallow-static-analysis-gate` 99/1, `fallow-analyze-script-and-ci-workflow` 19/10, and the three safety nets 63/0. Matches the report.

Both defects closed. The must-delete sanity check now validates the scanner against permanently-stable files instead of the files it requires deleted. The blanket "zero unused exports" assertion is replaced by `CITED_UNUSED_EXPORTS`, mirroring `PROTECTED_CITED_PATHS`.

**Claude corrected my classification, and was right.** I had listed `stripHtml`, `titleCase`, `appendUrl`, `buildCalendarItems`, `getByPath`, and `getArrayByPath` as removal candidates. Claude checked for same-file internal callers, which I had not, and found 18 of the 22 are live code called by already-used functions in their own module. Deleting them would have broken real callers. They are over-exported, not dead, and resolve safely by de-export alone. Only four have zero references anywhere and a defensible citation: `buildCSSTarget` (V2-07), `processLinks` (V2-07), `parseCookiesForPlaywright` (V2-14/V2-16), `getNewItemsFromRSS` (V2-04).

It also caught a bug in its own verification — a commented-out import in `workers/feed-updater.worker.ts` was being read as a live reference — and fixed the verification to strip comments rather than weakening the citation.

Residual judgment call I am accepting: the `parseCookiesForPlaywright` citation. The worker's own comment says it "might be simplified or removed if cookies are directly structured correctly." Its shape still matches V2-16's reachable-capability-without-UI gap, so it stays cited; Packet 5 should confirm when it restores the cookie editor.
