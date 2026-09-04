# Release Quality and Dependency Baseline — Implementation Plan

**Spec:** `../specs/2026-09-02-release-quality-baseline-design.md`  
**Roadmap:** Packet 1

## Context-efficient slice order

1. Cross-platform Playwright server startup and ephemeral E2E credentials (C12, H3).
2. Deterministic TypeScript/Biome configuration including frontend, then mechanical baseline cleanup (C3, H2).
3. Dependency classification, upgrades, `xmldom` replacement contract, audits, and lockfile reproducibility (B4, E8, S7).
4. Browser projects, 390 px coverage, representative axe fixture, and stable test artifacts.
5. V2 golden fixture/parity harness (V2-15) without changing application serializers yet.
6. Windows/Linux CI matrix plus secret, SAST, container/IaC, SBOM, and direct-network guards.
7. Clean-install rehearsal and one-command packet exit verification.

Each slice receives its own requirements brief and Claude Sonnet 5 test-author session. Related mechanical fixes may be grouped only after the tests define their boundary.

## Verification

- Narrow slice command at RED and GREEN.
- `bun run verify:static`, then `verify:core`, then `verify:full` as the baseline becomes capable of reaching each stage.
- Clean install from the lockfile on Windows and Linux CI.
- Dependency/security reports retained as workflow artifacts, not copied into prompts.
