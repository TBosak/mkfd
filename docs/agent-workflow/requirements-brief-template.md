# TDD Requirements Brief: `<slice-id>`

## Ownership

- Roadmap packet and finding IDs:
- Feature spec and implementation-plan links:
- Production surfaces owned by this slice:
- Test surfaces the authorized test author may add or edit:

## Behavioral contract

Use stable IDs and externally observable language. Keep this substantially smaller than the implementation context.

| ID | Required observable behavior |
|---|---|
| A1 | |

## Invariants and state transitions

| ID | Invariant or transition |
|---|---|
| I1 | |

## Errors and boundaries

| ID | Error condition or boundary behavior |
|---|---|
| E1 | |

## Current behavior and RED reason

Describe the current observable failure and the narrow command that establishes the pre-existing baseline. Include a minimal reproducer when useful.

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
- The authorized test author may modify only `tests/` and `frontend/e2e/`.
- The test author self-reviews, fixes routine test-side issues, runs the narrow deterministic checks, and returns a compact coverage manifest keyed by the stable requirement IDs.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Applicable edge/security/compatibility cases are covered.
- [ ] Failure messages identify the violated contract.
- [ ] Tests are isolated and deterministic.
- [ ] Targeted RED command and expected failure are stated.
