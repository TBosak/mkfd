# TDD Requirements Brief: `<slice-id>`

## Ownership

- Roadmap packet and finding IDs:
- Feature spec and implementation-plan links:
- Production surfaces owned by this slice:
- Test surfaces Claude may add or edit:

## Current behavior and RED reason

Describe the current observable failure and the narrow command that establishes the pre-existing baseline. Include a minimal reproducer when useful.

## Required observable behavior

List independently testable outcomes. State inputs, outputs, persisted/runtime effects, user-visible states, and error semantics without prescribing private implementation details.

## Required edge and adversarial cases

Address applicable boundaries: empty/min/max/oversize input, malformed data, legacy schema, secrets and masking, auth/CSRF, SSRF/DNS/redirects, timeouts/cancellation, concurrency/restart, partial failure, keyboard/mobile/accessibility, and v2 semantic round trips.

## Compatibility and migration invariants

State which v2 behavior or data must remain equivalent, which normalization is permitted, and which differences must fail the test.

## Non-goals

Name adjacent behavior that this slice must not test or implement.

## Test constraints

- No live third-party services.
- Deterministic fixtures and controlled time/randomness.
- Assert semantics rather than incidental formatting or private call structure.
- New required tests must demonstrate RED for the intended reason before implementation.
- Claude may modify only `tests/` and `frontend/e2e/`.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Applicable edge/security/compatibility cases are covered.
- [ ] Failure messages identify the violated contract.
- [ ] Tests are isolated and deterministic.
- [ ] Targeted RED command and expected failure are stated.
