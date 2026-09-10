# Test Scrutiny Review: `p3-request-body-limits`

## Verdict

`ACCEPTED FOR IMPLEMENTATION`

GPT-5.6 Luna is the user-authorized replacement test author while Claude weekly usage is unavailable. The role and write boundary remain unchanged.

## Requirement traceability

| Requirement | Test evidence | Review |
|---|---|---|
| 1 — 1 MiB fallback | `the fallback cap accepts exactly 1 MiB and rejects one additional byte` | Covered at exact/+1 with the real server. |
| 2 — 256 KiB state-changing class | `every state-changing method...` exact/+1 tests for POST, PUT, PATCH, DELETE | Covered across methods without relying on a private classifier. |
| 3 — 64 KiB webhook | declared exact/+1, UTF-8 exact/+1, chunked replay/oversize | Covered. |
| 4 — 8 KiB passkey | exact/+1 form and malformed multipart | Covered. |
| 5 — exact allowed, +1 rejected | fallback, passkey, webhook, and state-changing cases | Covered. |
| 6 — declared oversize rejected before parsing | malformed JSON/multipart return 413 rather than parser errors; header-only oversize request requires 413 before any body or EOF | Covered, including early header rejection. |
| 7 — chunked counting and replay | chunked UTF-8 webhook persists exact values; completed and still-open cap+1 uploads require 413 | Covered, including response before the terminating zero chunk. |
| 8 — encoded bytes | multi-byte webhook exact/+1 | Covered. |
| 9 — invalid length metadata | raw TCP negative, alphabetic, list, fractional, and conflicting duplicate lengths | Covered at the server boundary; all pass before implementation because Bun already rejects unsafe framing, which is valid baseline behavior. |
| 10 — sanitized stable 413 | shared semantic helper on every oversize case | Covered without snapshots or reflected marker data. |
| 11 — early mount/auth exceptions | passkey/webhook behavior plus anonymous/protected regressions | Covered except for the body-consumption timing gap below. |
| 12 — body-free and below-limit compatibility | readiness, published feeds, protected redirect, settings update, small webhook | Covered. |

## Missing cases or weak assertions

None remain. Revision 1 added a raw header-only oversize request that leaves the upload open and a chunked cap+1 request that omits EOF; both fail on the current server because no response arrives before the bounded fixture timeout. These make early rejection observable without prescribing a middleware implementation.

## Test correctness

- [x] Existing RED is caused by missing body limits, not setup/import/environment failure.
- [x] Existing behavior is not weakened.
- [x] Assertions are semantic and specific.
- [x] Real-server/TCP boundaries are the correct level.
- [x] Fixtures are deterministic and contain only test-scoped marker strings.
- [x] No required case is skipped, todo, or snapshot-approved.
- [x] Tests do not prescribe a production module or private design.
- [x] The author changed one new test file only.
- [x] Header-only and open-stream early rejection are observable rather than inferred.

## Feedback for GPT-5.6 Luna

Revision accepted. The test author changed only `tests/p3-request-body-limits.test.ts`. Independent RED: `bun test tests/p3-request-body-limits.test.ts --timeout=30000` → 6 pass / 10 fail / 47 expectations; all ten failures are the missing body-limit behavior, including the two intended open-upload timeouts.
