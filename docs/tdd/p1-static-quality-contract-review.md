# Test Scrutiny Review: `p1-static-quality-contract`

## Verdict

`RETURN TO CLAUDE`

## Requirement traceability

The first draft establishes a useful RED baseline (59 pass, 41 fail) for exact tool pins, portable script syntax, Biome scope, TypeScript parsing, Bun globals, and a dedicated E2E configuration. The failures are caused by current configuration gaps rather than setup crashes.

Several assertions remain too weak or incomplete, however. The suite can currently be made green with no-op scripts, can omit substantial production source from typechecking, and models Biome behavior without validating the installed Biome version that the contract requires.

## Missing cases or weak assertions

### Quality scripts are not proven to run their tools

- Missing observable behavior: each root/frontend half must actually run the pinned Biome or TypeScript tool, and each aggregate must actually invoke both relevant halves.
- Counterexamples that currently pass: `"lint:root": "bun scripts/noop.ts"`; an aggregate such as `"lint": "echo lint:root lint:frontend"`; or a frontend `typecheck` that checks only the app config while silently omitting the E2E config.
- Required assertion or scenario: prove the command graph, including both aggregate halves, the correct pinned tool at each leaf, and both frontend app and E2E TypeScript projects. Keep the contract platform-neutral and do not require a particular private helper filename. If an orchestrator is used, test an observable plan/dry-run or inspect and execute its declared command graph so merely mentioning script names cannot pass.
- Relevant requirement/spec reference: required behaviors 1, 3, and 6; adversarial case “Aggregate script invokes only one half.”

### Biome semantics are reimplemented instead of verified

- Missing observable behavior: the exact pinned local Biome binary accepts the repository configuration and treats representative root, frontend source, frontend E2E, and generated/runtime paths as required.
- Counterexample that currently passes: a glob combination whose result differs under Biome's own traversal/negation rules but happens to agree with the hand-written `biomeGlobMatches` approximation.
- Required assertion or scenario: supplement or replace the custom matcher with config-only probes against the installed local binary (never a network-downloaded `@latest` binary). Stdin file paths with valid source are suitable if they distinguish “checked” from “ignored” without exposing current application lint diagnostics. Validate that the configured schema/config is accepted by that pinned version.
- Relevant requirement/spec reference: required behaviors 4 and 7; adversarial case “Configuration passes JSON-shape checks but is rejected by the pinned tool.”

### Deprecated Biome rule syntax is not rejected

- Missing observable behavior: current, nondeprecated rule configuration.
- Counterexample that currently passes: `linter.rules.recommended`, which the target Biome release reports as deprecated in favor of the current preset form.
- Required assertion or scenario: explicitly reject deprecated `linter.rules.recommended` as well as the already-covered deprecated keys, and require the supported equivalent when recommended rules are enabled.
- Relevant requirement/spec reference: required behavior 4 and Packet 1 C4.

### TypeScript strictness and source coverage are incomplete

- Missing observable behavior: root strict checking is enabled, and root/frontend configs cover all applicable production source rather than one representative file.
- Counterexamples that currently pass: root `strict` omitted or `false`; an include list containing only `index.ts`; or a frontend config that includes a single file while excluding most of `frontend/src`.
- Required assertion or scenario: reject disabled/omitted root strictness and compare each parsed project against the applicable discovered production TypeScript files. Generated output, dependencies, tests, and frontend remain excluded from the root project as specified, but ordinary application directories/files must not be silently skipped.
- Relevant requirement/spec reference: required behaviors 5–6 and adversarial case “TypeScript configs hide source errors by disabling strict mode or adding broad skip patterns.”

### E2E project discovery is not truly filesystem-driven or unique

- Missing observable behavior: every present `frontend/e2e/**/*.ts` file is covered by exactly one explicit E2E project.
- Counterexamples that currently pass: a newly added E2E spec omitted from the hard-coded seven-file list, or two `tsconfig*.json` files both covering E2E sources.
- Required assertion or scenario: discover E2E TypeScript files from disk at test time and assert the set is covered by exactly one explicit E2E config, not merely at least one.
- Relevant requirement/spec reference: required behavior 6 and test-author edge-case expectation for missing/ambiguous E2E configuration.

### Claude-owned fixture typing must be completed before locking

The explicit E2E project will expose that `frontend/e2e/fixtures.ts` does not declare the `authenticatedPage` fixture generic on `base.extend`. That file is test harness code inside Claude's exclusive boundary and is already locked by the preceding slice. Codex must not repair it during production implementation.

Update the fixture typing now, without changing runtime behavior, and rerun the preceding `tests/e2e-harness-config.test.ts` suite as well as this slice. This is an authorized Claude revision; Codex will scrutinize the diff and refresh the preceding lock only after both suites pass their invariant expectations.

### Temporary probe cleanup

Wrap temporary-directory probes in cleanup so repeated local/CI runs do not accumulate stale files. This is a test-quality correction and must not weaken diagnostics.

## Test correctness

- [x] RED is caused by missing configuration behavior, not an import or environment crash.
- [x] Exact dependency-pin assertions are appropriately strict.
- [x] Portable command anti-pattern coverage is broad.
- [x] Current generated/runtime exclusions are represented.
- [ ] Leaf scripts and aggregate command graphs are behaviorally proven.
- [ ] Biome's own pinned implementation validates effective scope/configuration.
- [ ] Strictness and complete production-source coverage are proven.
- [ ] E2E coverage is dynamic and exactly one project owns it.
- [ ] Claude-owned E2E fixture types are ready for the later config implementation.

## Feedback for Claude

Revise the test suite and test fixture to close every gap above. Preserve useful assertions and the intended config-only scope: do not demand that the current application be lint- or type-error-free in this slice. Do not modify production/config/package files. Run the three static-quality test files plus `tests/e2e-harness-config.test.ts`, and report which failures remain intentional RED configuration gaps.

## Round 2 scrutiny after quota-interrupted revision

### Verdict

`RETURN TO CLAUDE AFTER SESSION RESET`

The interrupted Sonnet 5 revision produced valid partial work. Codex reran all four relevant files: the preceding E2E suite remains green (36/36), and the combined run is 85 pass / 56 fail. The new failures are configuration REDs, not network or import crashes. Claude also correctly added the `AuthenticatedPageFixtures` generic to its owned fixture.

The session ended at the provider quota boundary before the following review items were completed:

### Aggregate lint still has a false-positive implementation

- Counterexample: make `lint:root` and `lint:frontend` both run `biome lint .`, then make aggregate `lint` run the same all-repository command twice. Both half tests see a real Biome banner/frontend diagnostic, and the aggregate checked-file sum is greater than the root sum, even though the halves are not scoped and the aggregate does not demonstrably invoke each distinct half.
- Required correction: use the pinned binary's verbose/effective file reporting (or another deterministic observable approach) to prove the root half excludes frontend, the frontend half is frontend-scoped, and aggregate output contains both scopes. Do not depend on the existence of a current lint diagnostic in frontend source.

### Root strictness is still not asserted

`root tsconfig does not bypass strictness` only rejects `noCheck`; it does not assert `parsed.options.strict === true`. A root config with `strict` omitted or false still passes. Add the explicit assertion required by the brief.

### Production source coverage is still representative-only

The root and frontend application checks still accept only `index.ts` and one of `App.tsx`/`main.tsx`. A config can omit nearly all application source and pass. Discover applicable production `.ts`/`.tsx` files from disk and compare them with parsed `fileNames`, respecting only the brief's legitimate exclusions. Do not hard-code a small sample.

### E2E discovery and uniqueness are still incomplete

`requiredE2EFiles` remains hard-coded, so a new spec can be omitted. `findCoveringE2EConfig` returns the first match, so the test named “exactly one” does not reject two covering configs. Discover the current E2E files recursively and count covering configs explicitly.

### Temporary probe cleanup is still missing

`probeGlobalResolution` creates an OS temp directory without a `finally` cleanup. Add deterministic cleanup after the Compiler API probe.

### Test-harness lock handling

The authorized fixture generic changed `frontend/e2e/fixtures.ts`, so the old preceding-slice lock correctly fails while the behavioral suite remains green. Do not revert the type fix. After final test acceptance, Codex will refresh both affected slice locks from the reviewed hashes.

Resume the same Claude Sonnet 5 session after the reported 9:10 PM America/Chicago reset. Change only tests/fixture files, rerun the same four files, and provide the normal completion report.

## Round 3 scrutiny

### Verdict

`RETURN TO CLAUDE`

The resumed revision closes the five round-2 items and keeps the preceding E2E suite green. Two contract defects remain:

### Every E2E file must have one owner, not only Playwright config

The suite now proves exactly one config covers `playwright.config.ts`, but it does not prove exactly one config covers each discovered `frontend/e2e/**/*.ts` file.

- Counterexample: the dedicated E2E config covers Playwright plus all specs, while `frontend/tsconfig.json` also includes `e2e/**/*.ts` but excludes `playwright.config.ts`. The current union, single-covering-config, and complete-dedicated-config assertions all pass, although every spec is compiled by two projects.
- Required correction: for every dynamically discovered Playwright config/fixture/spec file, count the parsed frontend configs containing that exact file and require exactly one owner. Preserve the assertion that the same explicit E2E config coherently owns the full set.

### A matching frontend Biome pin is incorrectly forbidden

The test named “does not declare its own separate `@biomejs/biome` version distinct from the shared root pin” asserts that the frontend dependency is always `undefined`. The brief requires a shared exact version and forbids drift; it does not forbid the frontend package from declaring the same exact pin. Because the repository has a separate frontend manifest/lockfile, an identical frontend pin is a valid local-tool arrangement.

- Required correction: allow the frontend Biome dependency to be absent and resolve the root exact pin, or—if present—require it to be an exact pin identical to root. Reject ranges and mismatches. Do not force one dependency layout.

### Verification scope

Run only the four targeted files in this revision. Do not run the entire suite: the existing filesystem integration test rewrites `feed-state/filesystem/filesystem-test.json`, which causes the launcher's production-boundary guard to reject an otherwise valid test-only invocation.

Make only these final test corrections. Do not change the accepted fixture again unless required for test correctness, and do not modify production/configuration files.

## Final scrutiny

### Verdict

`ACCEPTED FOR IMPLEMENTATION`

Claude's final revision dynamically requires exactly one TypeScript-project owner for every Playwright config/fixture/spec file and permits either valid Biome dependency layout while rejecting range or version drift. Codex independently reran the four targeted files: 85 tests pass and 54 fail for the intended missing manifest/Biome/TypeScript configuration behavior. The prior E2E suite is green (36/36), no production source was changed by Claude, and the test suite is ready to lock.

## Post-GREEN quality review

### Verdict

`RETURN TO CLAUDE`

After Codex implemented the configuration contract, all 139 locked tests pass. Targeted Biome lint reports one warning in Claude-owned `frontend/e2e/fixtures.ts`: `let title` is assigned once and must be `const` (`lint/style/useConst`). Make only that semantic-preserving test-harness cleanup. Do not edit any production/configuration file or assertion. Run the four targeted test files and targeted Biome lint for the fixture plus the three static-quality tests and E2E harness test. The existing locks are expected to fail until Codex reviews and re-locks the authorized change.

## Final post-GREEN acceptance

### Verdict

`ACCEPTED FOR HANDOFF`

Claude changed only `let title` to `const title`. Codex independently confirmed 139/139 targeted tests pass and targeted Biome lint checks all changed production/test-harness files with zero warnings or errors. Both affected slice locks may be refreshed from these reviewed hashes.
