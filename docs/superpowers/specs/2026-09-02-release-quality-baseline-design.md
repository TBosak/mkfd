# Release Quality and Dependency Baseline — Design Spec

**Date:** 2026-09-02  
**Status:** Approved  
**Authority:** Mkfd v3 roadmap, Packet 1

## Goal

Make every later implementation claim reproducible from the lockfile on Windows and Linux, with one deterministic command family for static analysis, unit/integration tests, catalog checks, production builds, browser/accessibility tests, dependency policy, and security scanning.

## Required outcomes

- Root and frontend lint/typecheck complete with zero errors.
- Browser tests start both servers without POSIX-only shell syntax or committed reusable credentials and exercise desktop plus 390 px projects.
- Root and frontend dependencies meet the release policy; abandoned/reachable vulnerable packages are upgraded or replaced.
- CI runs clean install, static checks, tests, catalog validation, build, browser/accessibility checks, dependency audit, secret/SAST/container scanning, and SBOM generation on applicable Windows/Linux jobs.
- TDD automation enforces Claude Sonnet 5 test authorship, write boundaries, same-session revision, and immutable accepted tests.
- V2 golden fixtures and the parity matrix become mandatory release inputs before config implementation proceeds.

## Constraints

- Keep this packet infrastructure-only; application behavior belongs to later packets.
- Test credentials must be ephemeral and test-scoped, never production defaults.
- Commands must not depend on shell-specific environment-assignment syntax.
- CI and local commands use the committed lockfile and bounded, integrity-keyed caches.

## Acceptance

`bun run verify:full` and the security/dependency workflow succeed on supported Windows and Linux environments, with zero lint/typecheck errors and no unapproved release-policy vulnerability.
