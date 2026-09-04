# TDD Requirements Brief: `p1-fallow-static-analysis-gate`

## Ownership

- Roadmap packet and findings: Packet 1 follow-up. Scope added by product decision after the Packet 1 baseline slice; extends B4 (dependency hygiene) and the S10 static-analysis portion.
- Related roadmap findings this slice corroborates but does not fix: V2-02, V2-07, V2-14, V2-16.
- Production surfaces owned by this slice: `.fallowrc.json`, root `package.json` scripts and devDependencies, a new fallow CI workflow, `docs/security/static-analysis-exceptions.md`, deletion of provably dead modules, and the `domhandler` declaration.
- Claude-owned test surfaces: `tests/` and `frontend/e2e/` only.

## Current RED baseline

Measured with `fallow@3.22.0` and a `.fallowrc.json` ignoring `public/**`, `drizzle/**`, and `Mkfd Redesign/**`:

- 2965 files analyzed, maintainability 89.2, run time ~0.1 s.
- `fallow dead-code`: 22 unused files, 39 unused exports, 22 unused types, **1 unlisted dependency**, 1 circular dependency.
- `fallow dupes`: 49 clone groups. `fallow health`: 172 findings above threshold.
- No unused dependencies, independently confirming the Packet 1 removal work.

Three distinct categories inside the 22 unused files, established by source inspection rather than by trusting the tool:

1. **False positives (2).** `workers/feed-updater.worker.ts` and `workers/imap-feed.worker.ts` are spawned by path string at `utilities/worker-manager.utility.ts:93-94`, so no static import edge exists. They are live production code and must not be deleted.
2. **Genuinely dead (9).** `utilities/source-assistant/starter-configs/*.adapter.ts`. `starter-configs/index.ts` implements `buildStarterConfig` inline and imports none of them.
3. **Roadmap-pending (the remainder).** `CookiesManager.tsx` (V2-16), `KVEditor.tsx` (V2-02), the three `catalog/` components (Packet 8), and similar. Locked product decision 3 requires these be restored or migrated, never deleted to close a finding.

`domhandler` is imported as a type by `utilities/form-detection.utility.ts:3`, `utilities/rss-builder.utility.ts:3`, and `utilities/selector-suggestion.utility.ts:4`, but is absent from `package.json`. It resolves only through cheerio's hoisted transitive copy.

## Required observable behavior

1. Entry points are configured so that modules reached only by a runtime path string are not reported unused. Both workers must disappear from the unused-file set **because they are declared entry points**, not because a blanket ignore hides them. A test must prove that deleting a worker's entry-point declaration makes the analysis report it again, so the configuration is doing real work.
2. The nine provably dead starter-config adapters are removed. Before removal, prove nothing imports them and that `buildStarterConfig` behavior is unchanged for every `routeType` it supports.
3. `domhandler` is declared in the root manifest at a version matching the resolved graph, and no production source file imports a package that is absent from the manifest. This must be asserted structurally, covering `import`, `import type`, and `require` forms, and must not be satisfiable by adding the package to the frontend manifest instead.
4. `bun run analyze` runs the full fallow pipeline and exits non-zero on any finding. A separate CI workflow runs it on pull requests and relevant branch pushes. Exit code 2 (tool error) must fail the job and must be distinguishable from exit code 1 (findings).
5. Every remaining finding is either fixed or recorded in `docs/security/static-analysis-exceptions.md`. Each record declares the path, the finding type, the owning packet or V2 finding id, a rationale, and a review date. The document parses as structured data, mirroring the dependency-audit-exceptions contract.
6. An exception may not cover a whole directory of first-party source, may not use a wildcard path, and may not be dated more than one release cycle out. Roadmap-pending components are legitimate exception entries; genuinely dead code is not.
7. The gate is green at the end of this slice: `bun run analyze` exits zero with the accepted configuration and exception set.

## Anti-bypass and adversarial requirements

- The gate may not be weakened by `continue-on-error`, `|| true`, a redirect that discards the exit status, or an event condition that skips ordinary pull requests.
- `ignorePatterns` may cover generated, vendored, and build output only. A test must reject any pattern that would exclude first-party source under `utilities/`, `routes/`, `models/`, `workers/`, `lib/`, `node/`, `scripts/`, or `frontend/src/` — with the single documented exception of vendored UI primitives, which must be named explicitly rather than matched by a broad glob.
- A saved fallow baseline file may not be used to quarantine the current backlog wholesale; the exceptions document is the only permitted escape, and it is per-path.
- Suppression comments (`fallow-ignore-file`, `fallow-ignore-next-line`) in first-party source must be counted and held at an explicit ceiling, so findings cannot be silenced file by file.
- The workers must not be excluded via `ignorePatterns`; only an entry-point declaration is acceptable, per requirement 1.
- Deleting a roadmap-pending component to close a finding is a failure, not a fix. A test must assert that the files named in requirement 3 of the baseline above still exist.
- Do not fix complexity or duplication findings owned by later packets; do not implement V2-02, V2-07, V2-14, or V2-16 here.

## Test-author expectations

- Architecture tests for the fallow configuration, the CI workflow semantics, the manifest/undeclared-import contract, and the exceptions document.
- Behavior tests for `buildStarterConfig` covering every `routeType` before and after the adapter deletion, so the removal is proven safe rather than assumed.
- Reuse a single fallow invocation per test process; it is fast, but repeated spawns are wasteful.
- Run only the new and changed tests plus the four accepted Packet 1 lock sets. Do not run the full filesystem-mutating suite.

## Non-goals

- Refactoring the 172 complexity findings or 49 clone groups owned by Packets 3 through 6.
- Restoring the V2 capabilities the unused components belong to; those stay with their packets.
- The optional paid Fallow Runtime layer, the `--type-aware` pass, `fallow security`, and the MCP/LSP integrations.
- Frontend manifest changes beyond what requirement 3 forbids.

## Acceptance checklist

- [ ] Worker entry points are proven to be load-bearing, not ignore-based.
- [ ] The nine dead adapters are removed with `buildStarterConfig` behavior proven unchanged.
- [ ] `domhandler` and the no-undeclared-import contract are asserted structurally.
- [ ] The gate fails on findings and on tool error, and cannot be suppressed.
- [ ] `ignorePatterns`, baselines, and suppression comments are all bounded.
- [ ] Roadmap-pending components are proven to still exist.
- [ ] Targeted RED command and genuine failure breakdown are reported.

---

## Amendment 1 (product decision, supersedes requirements 4-7 above)

The gate changes shape. Enforcing the full backlog was measured at roughly 300
findings (82 dead-code, 49 clone groups, 173 health), and closing that with an
exceptions file would produce governance theatre rather than a meaningful gate.

**New direction: gate new code, fix the worst existing code, do not paper over
either with exceptions.**

### A. The CI gate judges changed code only

- CI runs `fallow audit`, which fails only on findings a change introduces, so
  the pre-existing backlog never blocks a pull request while new debt is
  stopped at the door.
- `bun run analyze` remains the full-pipeline local command and must keep
  using a flag that genuinely fails on findings. Note that `fallow --ci` is
  documented as equivalent to `--fail-on-issues` but was measured exiting 0
  with 82 findings present; only `--fail-on-issues` actually gates. A test
  must assert the gate command exits non-zero when findings exist, proving the
  flag works rather than trusting its documentation.
- The audit gate must not be weakened by `continue-on-error`, `|| true`, an
  exit-code-discarding redirect, a `--gate` setting that excludes introduced
  findings, or a base ref chosen to make the comparison empty.

### B. Exceptions are the last resort, not the mechanism

- `docs/security/static-analysis-exceptions.md` still exists and keeps its
  contract, but the expected steady state is an empty array.
- An exception is permitted only for a finding that is genuinely blocked on
  another packet's work. It is not permitted for a file that is simply dead.

### C. `ROADMAP_PENDING_PATHS` is over-broad and must be justified per file

The accepted suite protects all eleven currently-unused files from deletion.
That was a faithful reading of the original brief, but it is wrong: it
protects genuinely dead files and makes green unreachable without exceptions.

Split the list. A path may stay protected only with a cited reason — a V2
finding id or an owning packet whose scope will consume it. Everything else is
dead code and must be deleted, with the same "prove nothing imports it"
standard already applied to the nine starter-config adapters.

Provisional classification, to be verified rather than trusted:

- **Protected, cited:** `CookiesManager.tsx` (V2-16), `KVEditor.tsx` (V2-02),
  and the three `catalog/` components (Packet 8).
- **Delete unless a citation is found:** `SectionHeader.tsx`,
  `SectionPager.tsx`, `accordion.tsx`, `SettingsTab.tsx`,
  `lib/analytics/types.ts`, `models/imapconfig.model.ts`. All six are
  unreferenced anywhere in the repository outside the test that protects them.

### D. Fix the worst existing findings rather than recording them

In scope for this slice, because each is small, local, and owned by no other
packet:

- The `data-handler.utility.ts` to `rss-builder.utility.ts` circular
  dependency, which fallow flags as an initialization and tree-shaking risk.
- The unused exports fallow reports in first-party utilities, where removal is
  provably safe.

Complexity hotspots and clone groups inside surfaces owned by Packets 3 to 6
remain out of scope and are not exception candidates either; the audit gate
stops those surfaces getting worse.
