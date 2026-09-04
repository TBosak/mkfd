# TDD Requirements Brief: `p1-static-diagnostics-cleanup`

## Ownership

- Roadmap packet and findings: Packet 1; C3/H2 follow-through after `p1-static-quality-contract`.
- Feature spec and implementation plan: `docs/superpowers/specs/2026-09-02-release-quality-baseline-design.md`; `docs/superpowers/plans/2026-09-02-release-quality-baseline.md`.
- Production surfaces owned by this slice: source/config files responsible for current Biome error-level or TypeScript diagnostics; declaration-package devDependencies and lockfiles where a maintained type package is the correct fix.
- Claude-owned test surfaces: `tests/` and `frontend/e2e/` only.

## Current RED baseline

- `bun run lint -- --reporter=summary`: 286 files checked, 92 errors, 545 warnings, 13 infos. Generated/public/design/runtime trees are excluded. Error classes include frontend accessibility, hook dependencies, SVG titles, callback returns, control-character regexes, CSS/Tailwind parsing, and backend correctness rules.
- `bun run typecheck`: fails on missing maintained declarations plus strict model, protected-value, feed-mapping, worker, parser, nullable/error, and callback types. Frontend application and E2E configs are structurally valid.
- The newly added quality runner itself is type-correct; accepted configuration/E2E tests are 139/139 green.

## Required observable behavior

1. Root `bun run lint` exits zero with no error-level diagnostics across its configured root and frontend scope.
2. `bun run typecheck:root`, `bun run typecheck:frontend`, and aggregate `bun run typecheck` all exit zero without removing applicable source from their accepted project scopes.
3. Supported Tailwind/CSS syntax is parsed through the pinned Biome configuration; CSS or frontend styling files are not excluded and CSS lint is not disabled wholesale.
4. Frontend accessibility errors are repaired semantically: buttons have explicit types, labels retain a valid accessible association, clickable non-controls become real controls or receive complete keyboard semantics, and informative SVGs have accessible names while decorative SVGs are hidden correctly.
5. Hook dependency fixes preserve intended lifecycle behavior and do not introduce request/render loops, duplicate submissions, or unstable listener cleanup.
6. Backend correctness fixes preserve input/output behavior. Regex fixes retain their accepted character coverage; iterable callbacks return deliberately; switch/control-flow changes preserve branches; no unsafe parsing or error swallowing is introduced.
7. Strict TypeScript fixes narrow unknown/null/union values at real boundaries. Maintained declaration packages are preferred over local `declare module` shims. Protected values are resolved only through existing protected-value boundaries—never cast to plaintext strings.
8. Existing unit/integration tests and Windows Playwright behavior remain green. No v2 fields, Selector Playground behavior, FlareSolverr behavior, or supported feed/source path is removed to satisfy static analysis.
9. The accepted `p1-cross-platform-e2e-launch` and `p1-static-quality-contract` tests remain unchanged except for an explicitly returned Claude-owned test correction.

## Anti-bypass and adversarial requirements

- Do not disable the linter, recommended preset, strict TypeScript, or any currently failing error-level rule globally or for a broad directory.
- Do not add source exclusions, blanket `biome-ignore`, `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `noCheck`, or `skip` patterns to obtain green.
- Do not replace errors with unchecked `any`, non-null assertions, double casts (`as unknown as`), empty catch blocks, or silent default values that change behavior. Test the current unsafe-escape counts and reject increases.
- Do not treat compiled assets, design references, generated feeds, runtime state, reports/results, dependencies, or migrations as source merely to change the diagnostic baseline.
- Do not require warning-only cleanup in files scheduled for schema/UI rewrites in later packets. Instead, cap warning diagnostics at the current 545 baseline so this slice cannot add debt; error-level and compiler diagnostics must reach zero.
- Configuration/test probes must be offline and deterministic.

## Test-author expectations

- Add an architecture test that executes the real local commands and asserts the exit/result contract without snapshotting thousands of diagnostics.
- Add anti-bypass tests for rule downgrades, source exclusions, suppression directives, strictness, and unsafe-escape count growth.
- Cover representative error families where a false green could change runtime or accessibility semantics; use source-level structural assertions only when a component/unit harness is unavailable.
- Prove RED from current lint/typecheck errors, not from missing binaries or network access.
- Do not run the entire `tests/` suite inside the Claude launcher: an existing filesystem integration test rewrites tracked feed-state timestamps and trips the production-boundary guard. Run only the new test file plus the accepted static/E2E architecture files.

## Non-goals

- Eliminating all 545 warning-only diagnostics where the owning code will be rewritten in later roadmap packets.
- Dependency vulnerability upgrades/classification beyond declaration packages required for type safety.
- Product redesign, schema migration, security-boundary changes, or feature removal.

## Acceptance checklist

- [x] Lint error-level and all three typecheck entry points are meaningfully asserted.
- [x] Rule/config/source-exclusion/suppression escapes cannot fake green.
- [x] Unsafe escape counts cannot increase.
- [x] Accessibility and hook fixes are required to preserve semantics.
- [x] Existing accepted test hashes stay unchanged.
- [x] Targeted RED command and failure reasons are reported.
