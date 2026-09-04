# TDD Requirements Brief: `p1-dependency-ci-security-baseline`

## Ownership

- Roadmap packet and findings: Packet 1; B4, H1-H3, S7, S10 supply-chain portion, and the remaining quality/dependency baseline work.
- Feature spec and implementation plan: `docs/superpowers/specs/2026-09-02-release-quality-baseline-design.md`; `docs/superpowers/plans/2026-09-02-release-quality-baseline.md`.
- Production surfaces owned by this slice: root/frontend manifests and lockfiles; `utilities/existing-feed-parser.utility.ts`; Docker dependency installation only; Playwright project configuration; `.github/workflows/`; compact dependency-policy documentation and CI orchestration scripts where needed.
- Claude-owned test surfaces: `tests/` and `frontend/e2e/` only.

## Current RED baseline

- `bun audit --json` currently reports a reachable Critical and multiple High findings, including the abandoned `xmldom@0.6.0`, vulnerable Hono, Axios/form-data, js-yaml, mailparser transitive Nodemailer/linkify-it, Cheerio transitive Undici, and node-imap transitive semver chains.
- Direct requirements permit old vulnerable resolutions: Axios `^1.8.2`, Hono `^4.6.8`, js-yaml `^4.1.0`, mailparser `^3.7.2`, and `xmldom ^0.6.0`.
- The manifests retain misclassified/unused packages: runtime `bun`, `bun-types`, third-party `readline`, `@types/xml`, `@types/xmldom`, and unused frontend `zod` / `@hookform/resolvers`.
- No primary pull-request quality workflow proves frozen-lock installation, static checks, unit/integration tests, catalog validation, production build, or Playwright on both Linux and Windows.
- Playwright has only desktop Chromium and no representative automated accessibility assertions. There is no 390 px project.
- Existing deployment workflows do not constitute a supply-chain security gate. Secret scanning, dependency review/audit, SAST, filesystem/IaC/container scanning, and SBOM evidence are absent or incomplete.
- Docker uses `bun install` without `--frozen-lockfile`.

## Required observable behavior

1. Replace `xmldom` with the maintained `@xmldom/xmldom` package and its built-in types. Existing feed parsing remains behavior-compatible for RSS/Atom inputs, rejects or safely handles malformed XML, and does not expand external entities or turn hostile declarations into file/network reads. Do not weaken parser tests to accept silent data corruption.
2. Set safe direct dependency floors that resolve the current advisories: Axios at least 1.18.0, Hono at least 4.12.34, js-yaml at least 4.3.1, mailparser at least 3.9.20, and `@xmldom/xmldom` at least 0.9.12. The frozen lock graph must resolve form-data at least 4.0.6, linkify-it at least 5.0.2, Nodemailer above 9.0.0, and Undici at least 7.29.0. Later safe versions are valid.
3. Remove dependency declarations that production/source search proves unnecessary or platform-provided: runtime `bun`, `bun-types`, third-party `readline`, `@types/xml`, `@types/xmldom`, and unused frontend `zod` / `@hookform/resolvers`. Native `node:readline` should be used. Keep `@types/bun` as the single Bun type source.
4. `bun audit --json` over the resulting frozen graph reports zero Critical or High advisories. Moderate/Low findings may remain only when they are development-only or demonstrably unreachable and are documented with package path, rationale, mitigation, and a review/expiry condition. Tests should prove the lock graph and policy deterministically without depending on live advisory availability; the live audit is broader verification.
5. Add a primary CI workflow triggered for pull requests and relevant branch pushes. It must install from the frozen root and frontend lockfiles and run lint, all typechecks, backend unit/integration tests, catalog validation, production build, and Playwright on both `ubuntu-latest` and `windows-latest`. Commands must be non-interactive and work on both shells. Browser installation may use OS-appropriate steps but must not skip either OS.
6. Extend Playwright with an explicit 390 px mobile Chromium project while retaining desktop Chromium. Add `@axe-core/playwright` and representative authenticated accessibility coverage for the application shell plus at least My Feeds, Builder, Health, and Settings. The test must fail on serious/critical violations and include a useful route/project failure message; it must not disable broad axe rules to manufacture green.
7. Add supply-chain workflows or jobs that provide all of the following evidence: full-history secret scanning, dependency review/audit, CodeQL/SAST, filesystem and IaC scanning, a built-container vulnerability scan, and an SPDX or CycloneDX SBOM uploaded as an artifact. Workflows use least-privilege permissions, immutable commit-SHA pins for third-party actions, no `continue-on-error` on release gates, and no privileged Docker/network-host escape merely for convenience.
8. Clean-install reproducibility is enforced everywhere relevant: CI and Docker use frozen lockfiles, both root and frontend dependency graphs are installed, and the production build consumes exactly those graphs. Cache keys, if used, include lockfile integrity and never cache mutable credentials.
9. Existing deterministic quality commands, the ten-file static acceptance suite, Windows Playwright behavior, Community Catalog validation, Selector Playground, FlareSolverr, and supported feed output behavior remain intact. The three earlier Packet 1 test locks must remain unchanged unless Codex explicitly returns a conflict to Claude for revision.

## Anti-bypass and adversarial requirements

- Do not satisfy version checks with comments, unused alternate manifests, package aliases to vulnerable versions, Git/URL dependencies, or a lockfile that does not match the manifest.
- Do not suppress audit/scanner failures with `continue-on-error`, unconditional `|| true`, blanket ignore files, skipped matrix entries, or event conditions that keep gates from running on ordinary pull requests.
- Do not claim dual-OS coverage from a matrix value that is never consumed by `runs-on`, or mobile coverage from a named project that keeps a desktop viewport.
- Do not make accessibility green by excluding whole pages, broad impact levels, or all rules. Scoped exceptions require an explicit issue/rationale and are not expected in this slice.
- Workflow tests must parse YAML/structures and validate effective jobs/steps; brittle string-presence assertions alone are insufficient. Include helper fixtures for deceptive matrices, floating action tags, hidden `continue-on-error`, missing frozen flags, and incomplete scanner/SBOM coverage.
- Dependency tests must compare semantic versions correctly (including multi-digit segments and prereleases) and exercise vulnerable/safe boundary fixtures.
- CI/source probes should be offline and deterministic. Network-dependent `bun audit` and action execution belong to broader verification, not the unit-test prerequisite.
- Do not implement the Packet 3 shared outbound executor or Packet 2 application authentication changes in this slice.

## Test-author expectations

- Add focused architecture tests for manifest/lock dependency policy, CI/supply-chain workflow semantics, Docker frozen installs, and Playwright desktop/mobile/accessibility wiring.
- Add or extend behavior tests for the maintained XML parser, including ordinary RSS/Atom, malformed input, external-entity/DOCTYPE payloads, and bounded failure behavior that can be verified without real network or filesystem access.
- Add one representative Playwright accessibility spec using the existing authenticated fixture and route helpers. Keep it deterministic against the current UI; report any genuine existing UI violations as RED rather than excluding them.
- Reuse parsed manifests, lockfiles, workflows, and subprocess results within a test process so architecture checks do not repeatedly run expensive commands.
- Run only the new/changed tests plus the accepted ten-file static suite and relevant existing parser tests. Do not run the full filesystem-mutating suite from the Claude launcher.

## Non-goals

- Packet 2 runtime authentication, session, protected-value encryption, Selector Playground isolation, or container runtime hardening.
- Packet 3 central outbound executor and direct-network primitive guard.
- Eliminating every Moderate/Low development-tool advisory when no safe upstream resolution exists; such exceptions must still be documented and must not be shipped/reachable.
- Route-level bundle splitting; Packet 4 owns the existing Vite large-chunk advisory.

## Acceptance checklist

- [ ] Maintained XML parser behavior and hostile-input cases are required.
- [ ] Direct dependency floors, transitive lock resolutions, removals, and frozen-lock integrity are asserted semantically.
- [ ] Critical/High audit policy cannot be bypassed by aliases, stale locks, or workflow suppression.
- [ ] Linux and Windows run the complete quality/browser gate.
- [ ] Desktop plus real 390 px Playwright projects and representative axe coverage are required.
- [ ] Secret, dependency, SAST, filesystem/IaC, container, and SBOM gates are structurally proven with least privilege and immutable action pins.
- [ ] Earlier accepted test hashes remain unchanged.
- [ ] Targeted RED command and genuine failure breakdown are reported.
