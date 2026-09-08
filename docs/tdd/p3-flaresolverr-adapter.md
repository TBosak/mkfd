# TDD Requirements Brief: `p3-flaresolverr-adapter`

## Ownership

- Roadmap packet and findings: Packet 3, "put browser automation and required FlareSolverr support behind explicit adapters with separately documented trust/egress controls… Validate the service endpoint and target separately, bind requests to the validated destination, intercept browser subresources, enforce total budgets."
- Production surfaces owned by this slice: the FlareSolverr call sites in `routes/utils.ts`, `utilities/data-handler.utility.ts` (two), `utilities/feed-config-route-adapter.utility.ts`, `utilities/preview-generator.utility.ts`, `utilities/selector-suggestion.utility.ts`, `workers/feed-updater.worker.ts`, and a new adapter module.
- Explicitly NOT in this slice: Playwright/browser subresource interception. That is the other half of the roadmap bullet and is a separate slice — say so if you find it entangled, but do not implement it here.
- Do not modify any locked test. Seventeen slices are locked, including the nine `p3-shared-outbound-executor` files and `tests/outbound-network-primitives-architecture.test.ts`.
- Claude-owned test surfaces: `tests/` only.

## Current RED baseline

`bun run verify:core` = **1698 pass / 0 fail** at commit `cd3cd08`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed**. Seventeen test locks verify.

Static gate: **zero errors, 542 warnings, 10 infos** against a locked ceiling of 545/13. Stay at or below 542/10. Three anti-bypass gates count `noExplicitAny`, `noNonNullAssertion` and `as unknown as` and refuse growth; the last greps raw text, so it counts the string inside a **comment** too.

### The defect

There are **seven direct `axios.post` calls to FlareSolverr across six files**, each rebuilding the request payload by hand. That duplication has already produced inconsistent security behaviour, which is the actual finding:

| Call site | Validates the FlareSolverr URL first? |
|---|---|
| `routes/utils.ts:290` | yes |
| `utilities/feed-config-route-adapter.utility.ts:154` | yes |
| `utilities/preview-generator.utility.ts:90` | yes |
| `workers/feed-updater.worker.ts:321` | yes |
| **`utilities/data-handler.utility.ts:216`** | **no** |
| **`utilities/data-handler.utility.ts:362`** | **no** |
| **`utilities/selector-suggestion.utility.ts:387`** | **no** |

Those three take `flaresolverr.serverUrl` — a value the **feed author supplies in config** — and POST to it with no outbound-policy check at all. That is an SSRF vector with a friendly name: point a feed's "FlareSolverr server" at `http://169.254.169.254/` or an internal admin endpoint and the app will POST to it, from inside the network, on a schedule.

Four sites got this right and three did not, which is what hand-copied network code produces over time. An adapter makes the check unskippable rather than remembered.

## Required observable behavior

1. **One adapter is the only way to reach FlareSolverr.** Every one of the seven call sites goes through it. Prove each site refuses a blocked FlareSolverr endpoint **through its own public entry point**, not by asserting the adapter was called.
2. **The service endpoint is validated on every call, including the three that skip it today.** A `serverUrl` pointing at a private address, a cloud metadata host, a non-HTTP(S) scheme, or a credentialed URL is refused before any request leaves.
3. **The endpoint and the target are validated separately.** FlareSolverr takes a `url` to fetch *and* lives at its own address; both are attacker-influenced and both must pass the policy independently. Prove a permitted endpoint with a blocked target is refused, and a blocked endpoint with a permitted target is refused — the two checks must not be collapsed into one.
4. **The request is bound to the validated destination**, consistent with what `p3-shared-outbound-executor` established for ordinary fetches. If address pinning cannot apply here, say why rather than quietly omitting it.
5. **A total budget bounds the call.** FlareSolverr is slow by design and its timeout is feed-author supplied. Prove the adapter enforces an overall deadline rather than trusting whatever `maxTimeout` the config asks for, and that a hostile-large timeout cannot extend it indefinitely.
6. **Credentials and endpoints never reach a log.** The FlareSolverr URL can carry credentials and the payload can carry cookies. Reuse `redact()` from `utilities/log-redaction.utility.ts`; prove a failure path does not emit the endpoint or a cookie value.
7. **Every existing FlareSolverr flow still works.** Explicit preview, scheduled worker execution, the drill chain, selector suggestion, sample-HTML fetching, and the Selector Playground proxy all use FlareSolverr today. This is the compatibility requirement: the slice centralises the call, it does not change what any flow can do.

## Anti-bypass and adversarial requirements

- Do not satisfy requirement 1 by leaving a direct `axios.post` in place and adding validation beside it. The point is that the call site cannot skip the check.
- **The adapter's own HTTP call must live outside `routes/`, `utilities/`, `workers/` and `node/`.** The locked architecture gate scans those four directories and its exception ledger is pinned at exactly 12 entries, so a new direct call inside them cannot be exempted. `lib/outbound/` already holds the approved low-level primitive for this reason; follow that precedent.
- Do not weaken or duplicate the SSRF rules. Reuse `assertAndResolveOutboundTarget` / `assertOutboundFetchAllowed` from `utilities/outbound-fetch-policy.utility.ts`.
- Do not disable FlareSolverr to close the finding. It is a supported feature and locked slices depend on its flows.
- Do not widen a type to `any` or add a non-null assertion; two anti-bypass gates count both.
- **Run `bun run verify:static` before reporting.** Denied on nine consecutive slices; if denied again, say so explicitly rather than assuming.
- Run each new test file 6-8 times and confirm the split is identical.

## Test-author expectations

- Integration tests driving each of the six files' real public entry points with a blocked FlareSolverr endpoint, so a future refactor that bypasses the adapter fails.
- A local HTTP server on an ephemeral port standing in for FlareSolverr where a successful path must be exercised. No test may reach a real third-party host.
- For requirement 5, prove the deadline with a server that delays, not by asserting a number was passed.

## Notes and open questions for the lead

Flag rather than guess:

- Whether the adapter should return FlareSolverr's `solution.response` directly or a normalised result. Six call sites currently each unwrap `data?.solution?.response` and check `solution.status === 200` by hand; centralising that is tempting but changes what each caller sees. Say what you assume.
- After this slice the ledger's six FlareSolverr exception entries will match nothing, since those call sites will be gone. The locked test pins the array at 12 entries and only requires that *at least one* exception still covers a real site, so this does not break it — but the stale entries should be removed by a future lock refresh. Confirm the count of still-covered sites so I can record it accurately.
- Whether `utilities/feed-config-route-adapter.utility.ts`'s FlareSolverr call belongs to this slice at all, given that file is part of the executor contract. I believe it does — it is a FlareSolverr call, not executor decision logic — but say if migrating it disturbs any locked executor test.
