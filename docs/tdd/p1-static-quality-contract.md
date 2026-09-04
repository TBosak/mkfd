# TDD Requirements Brief: `p1-static-quality-contract`

## Ownership

- Roadmap packet and finding IDs: Packet 1; C3 and H2, with E8 dependency-classification overlap limited to tooling packages.
- Feature spec and implementation-plan links: `docs/superpowers/specs/2026-09-02-release-quality-baseline-design.md`; `docs/superpowers/plans/2026-09-02-release-quality-baseline.md`; `docs/mkfd-v3-implementation-roadmap.md` Packet 1.
- Production surfaces owned by this slice: root/frontend `package.json`, `biome.json` files, root/frontend TypeScript configuration, and `bun.lock` for pinned quality-tool dependencies.
- Test surfaces Claude may add or edit: `tests/` and `frontend/e2e/` only.

## Current behavior and RED reason

The root Biome config explicitly excludes `frontend`, so the only lint command misses frontend defects. Root `bun run typecheck` fails before checking source because `moduleResolution: "node"` resolves to removed Node10 behavior and `bun-types` cannot be resolved through the narrowed `typeRoots`. Root Biome and TypeScript are invoked through unpinned `bunx`, making tool behavior drift over time. Frontend has neither `lint` nor `typecheck` scripts.

The targeted architecture tests must fail against these observable configuration defects without requiring the existing application lint/type errors to be fixed in this slice.

## Required observable behavior

1. Root devDependencies pin exact (no range prefix) supported versions of `@biomejs/biome` and `typescript`; scripts execute those local pinned tools through Bun.
2. Root scripts expose `lint:root`, `lint:frontend`, `typecheck:root`, and `typecheck:frontend`; aggregate `lint` and `typecheck` invoke both halves through platform-neutral Bun commands without `cd`, shell chaining, or inline environment assignment.
3. Frontend package scripts expose local `lint` and `typecheck` commands using the same pinned tool versions available from its dependency graph.
4. Checked-in Biome configuration includes frontend source/config/E2E files in the lint surface while continuing to exclude generated/dependency/runtime artifacts such as node_modules, build output, Playwright reports/results, public generated feeds, and `.tdd-state`.
5. Biome schema/configuration matches the pinned major/minor tool version and uses current, non-deprecated rule configuration.
6. Root TypeScript uses a supported resolution mode compatible with ESM/Bun, resolves the canonical `bun` type package without a narrowed `typeRoots` trap, and does not compile frontend files under the root config.
7. Frontend TypeScript remains strict, checks `src`, and has an explicit config that typechecks Playwright config/E2E fixtures/specs with the correct custom `authenticatedPage` fixture type.
8. A configuration-only probe (`tsc --showConfig` or equivalent) succeeds for root application, frontend application, and frontend E2E projects, proving there are no missing type libraries or removed compiler options before source diagnostics are considered.
9. Existing build, test, E2E, catalog, TDD, and verification script entry points remain present.

## Required edge and adversarial cases

- Reject scripts that appear cross-platform but delegate to `sh`, `bash`, `cmd`, PowerShell, or use `&&`, `;`, or inline `NAME=value` assignment.
- Reject aggregate scripts that invoke only one half, recurse into themselves, or rely on a globally downloaded latest tool.
- Reject broad `frontend` exclusions and negation-order tricks that still leave representative `frontend/src`, `frontend/e2e`, or `frontend/playwright.config.ts` files ignored.
- Reject TypeScript configs that hide source errors by disabling strict mode, adding `skip` patterns for source, using `noCheck`, or excluding the E2E fixture/specs.
- Reject version ranges and mismatched root/frontend TypeScript versions.
- Tests must not require current application lint/type diagnostics to be green; later TDD slices repair those diagnostics.

## Compatibility and migration invariants

- `bun run lint`, `bun run typecheck`, `bun run verify:static`, `bun run test`, `bun run test:e2e`, `bun run build`, and both `tdd:*` commands remain stable public contributor entry points.
- Frontend production build behavior is unchanged.
- Accepted tests from `p1-cross-platform-e2e-launch` remain immutable.

## Non-goals

- Fixing the hundreds of existing application lint/type diagnostics.
- Dependency vulnerability upgrades beyond pinning the two quality tools.
- Adding mobile/axe projects or CI workflows.
- Changing runtime/application behavior.

## Test constraints

- No network access and no live server/browser.
- Parse manifests/configs and use local configuration probes; do not snapshot entire files.
- Assert effective inclusion/exclusion behavior for representative paths, not only textual absence of `!frontend`.
- New tests must demonstrate RED for configuration defects rather than current source diagnostics.
- Claude may modify only `tests/` and `frontend/e2e/` and must not alter the already locked files from the prior slice.

## Acceptance checklist

- [ ] Every required behavior and script invariant has a meaningful assertion.
- [ ] Cross-platform, recursion, global-tool, ignored-path, deprecated-config, and strictness bypass cases are covered.
- [ ] Configuration probes are deterministic and offline.
- [ ] Prior accepted test hashes remain unchanged.
- [ ] Targeted RED command and expected failure are stated.
