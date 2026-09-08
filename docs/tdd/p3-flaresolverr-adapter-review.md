# Test Scrutiny Review: `p3-flaresolverr-adapter`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` — first round. The fifth slice running to need no revision.

- Session `4b575137-871d-4527-a0dc-48b7c3ce4b33` (`claude-sonnet-5`, 109k output over 121 turns; a 17-token `claude-haiku` entry is auxiliary). `is_error: false`. 15 permission denials.
- Seven new files: one per call site, plus shared behaviour and a static guard.

Independent RED reproduction: **1711 pass / 17 fail** across `tests/` (1728 total = the 1698 baseline plus 30 new), identical across six consecutive runs. Per file: shared-behavior 0/2 and static-guard 0/6 (module-load failures — the adapter does not exist yet), data-handler 3/4, selector-suggestion 2/4, feed-config-route-adapter 2/1, preview-generator 3/0, worker 3/0.

Verified independently — and this matters, because the author reported it could not run either gate itself: `bun run verify:static` at **zero errors, 542 warnings, 10 infos**, and `bun run typecheck` clean. All seventeen existing locks verify.

## The RED lands exactly where the defect is

`preview-generator` and `worker` pass at 3/0 because those two sites already validate their FlareSolverr endpoint. `data-handler` and `selector-suggestion` carry eight failures between them — those are the three sites that POST to a feed-author-supplied `serverUrl` with no outbound-policy check at all.

That asymmetry is the right shape for this slice and worth stating plainly: the tests are not uniformly red, and they should not be. Two call sites were already correct; three were not; the adapter makes the difference unrepresentable.

## Behaviour, not arguments

The two shared-behaviour tests are the sharpest in the suite:

- **Requirement 4** proves a redirect returned by *the FlareSolverr endpoint itself* is revalidated — `hop 2 must never be reached by an unrevalidated FlareSolverr-endpoint redirect`. This is the FlareSolverr-specific gap, and the author was right not to re-prove DNS-pinning mechanics that the locked `tests/outbound-executor.utility.test.ts` already covers at the primitive level.
- **Requirement 5** sets `flaresolverr.timeout` to `2000000000` and asserts the call settles well before a 20-second wall-clock ceiling. A hostile-large timeout is exactly how a feed-author-supplied budget becomes a denial of service, and the test proves the enforced budget wins rather than asserting a number was passed along.

Requirement 3 is covered in both directions, including the stronger form I did not think to ask for: *the endpoint must never be contacted when the target fails its own, separate check*. Collapsing the two validations would fail that.

## Rulings on the open questions

1. **The 20-second ceiling stands.** The author asked whether the intended enforced budget might exceed it. It should not: FlareSolverr is slow by design, but a total budget that allows more than twenty seconds of wall clock for a single solver call is not a budget. Derive it from the feed run timeout and cap it; do not widen the test.
2. **The adapter returns a normalised result, not raw `solution.response`.** Six call sites each unwrap `data?.solution?.response` and check `solution.status === 200` by hand today. Centralising that is the point of an adapter — six hand-rolled unwrappings are six chances to forget the status check, which is the same failure mode as the three missing validations.
3. **Ledger staleness confirmed and bounded.** After migration the six FlareSolverr exception entries match nothing, while six non-FlareSolverr entries stay live (jellyfin connector ×3, the playground proxy, webhook delivery, and the rss-builder enclosure probe). The locked non-vacuity check requires only that at least one exception covers a real site, so it holds at six. Filed as **CF-13** for a future lock refresh to remove the dead entries.
4. **`feed-config-route-adapter.utility.ts`'s FlareSolverr call belongs to this slice.** It is a FlareSolverr call, not executor decision logic, and its migration disturbs no locked executor test — all nine verify unchanged.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 1711 pass / 17 fail.
- [x] Each call site is driven through its own public entry point, not by asserting the adapter was called.
- [x] Endpoint and target validation proven separately, in both directions.
- [x] The budget is proven with a real delay; the redirect revalidation with a real second hop.
- [x] Zero errors; warnings and infos held at 542 / 10 — verified by me, since the author was denied both gates.
- [x] `bun run typecheck` clean; all seventeen existing locks verify.
- [x] Deterministic across six runs.
- [x] No `.only` / `.skip` / `.todo`; no `any`, non-null assertion, or double cast in any new file.
- [x] Claude changed test files only.

The suite is locked and implementation may begin.
