# Workbench v2 Frontend Redesign — Implementation Plan

**Spec:** `../specs/2026-09-02-workbench-v2-frontend-redesign-design.md`  
**Roadmap:** Packet 5

## Dependencies

Packets 2 and 3 must freeze authentication/protected-value behavior, the config normalizer, source registry, outbound executor, and settings contract. Packet 4 precedes this plan when one agent owns all frontend work.

## Order of work

1. Check in v2 golden web/API/email fixtures and a field/action parity matrix.
2. Define the typed builder wire model and exhaustive frontend↔backend conversion contract.
3. Implement lossless edit/save normalization for shared values, CSS targets, mappings, metadata, enabled state, and webhooks.
4. Drive source selection, steps, fields, preview support, and actions from the source registry.
5. Repair responsive shell/preview behavior and unified submission/validation/focus state.
6. Restore v2 actions and inputs: selector suggestion, Selector Playground, explicit FlareSolverr, API cookies, email Output/Delivery, webhook controls, and guarded source switching.
7. Complete source-specific forms only after their runtime path is release-capable; otherwise show an honest unavailable state.
8. Remove superseded builder paths only after golden round-trip and browser parity tests pass.

## TDD slices

Group slices by shared serialization and UI context to avoid repeatedly loading the same surfaces:

- v2 golden fixture harness and semantic comparator;
- canonical rich key/value and protected-value round trip;
- complete web CSS-target/metadata/enabled round trip;
- complete API mapping/cookie round trip;
- email Output/Delivery and webhook round trip;
- source registry and exhaustive routing;
- responsive workbench and submission state;
- selector suggestion/Playground/FlareSolverr parity;
- source-switch dirty-state behavior;
- one create→preview→save browser flow per enabled source.

Claude Sonnet 5 authors/revises each slice's tests. Codex accepts and locks them before production changes.

## Verification

- Semantic v2 round-trip suite.
- Targeted unit/integration tests per source conversion.
- Playwright at desktop and 390 px with keyboard and representative axe coverage.
- Production build and route-level bundle budget.
- `bun run verify:full` at packet exit.

## Completion rule

The workbench is Ready only after every enabled source has a real create-to-output path and every v2 parity obligation in the spec passes without changing accepted Claude-authored tests.
