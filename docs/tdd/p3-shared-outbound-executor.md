# TDD Requirements Brief: `p3-shared-outbound-executor`

## Ownership

- Roadmap packet and findings: Packet 3, the outbound HTTP(S) executor bullet and the "no user-controlled URL sink bypasses the shared executor" exit criterion. Audit S3/S4/S6.
- Production surfaces owned by this slice: `utilities/outbound-fetch-policy.utility.ts`, `utilities/fetch-policy.utility.ts`, whatever consolidated executor module the implementation introduces, and the call sites named in requirement 7.
- Explicitly NOT in this slice: the browser-automation and FlareSolverr adapters, the settings registry, the feed-config normalizer, retry/fallback modes, Drizzle migrations. Those are separate Packet 3 slices and the roadmap says not to parallelize changes to the executor/config/settings contracts — so this slice freezes the executor API and the others build on it.
- Claude-owned test surfaces: `tests/` only. Nothing here is browser-observable.

## Current RED baseline

`bun run verify:core` = **1469 pass / 0 fail** at commit `4749046`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed**. Twelve test locks verify. Static ceiling **545 warnings / 13 infos, zero errors** — locked, and broken by three slices already.

Packet 2 is complete, so the trust boundary, protected values, CSP, container and logging work this builds on is all closed and locked.

### What already exists

This is not a greenfield slice, and the brief would be wrong to imply it. Two utilities already carry most of the policy:

- `utilities/outbound-fetch-policy.utility.ts` (434 lines) — `assertOutboundFetchAllowed` validates scheme, blocks cloud metadata hostnames absolutely, detects literal IPv4/IPv6, resolves DNS and rejects private/blocked addresses, and supports an allowlist plus a per-feed override.
- `utilities/fetch-policy.utility.ts` (125 lines) — `executeWithFetchPolicy` applies a run deadline, `maxRedirects`, and `maxContentLength`/`maxBodyLength`.

The SSRF thinking is sound. The defects are structural.

### The defects

1. **Nothing forces the policy to be used.** There are 21 direct `axios.*` calls and 3 direct `fetch(` calls across `routes/`, `utilities/`, `workers/` and `node/`. Each call site decides for itself whether to consult the policy. `assertOutboundFetchAllowed` is an *assertion helper* a caller may simply not call, so the protection is a convention, not a boundary — and a new sink added tomorrow is unprotected by default. This is the defect the roadmap's exit criterion is about.

2. **Validation and connection are separate, so DNS is time-of-check/time-of-use.** The policy resolves the hostname and checks the addresses; the HTTP client then resolves the hostname *again* and connects to whatever it gets. A DNS record that answers with a public address on the first lookup and a private one on the second defeats the check entirely. Closing this means the request must connect to the address that was validated, while preserving the TLS SNI and `Host` header for the original hostname.

3. **Redirects are counted but not necessarily revalidated.** `maxRedirects` bounds how many redirects are followed. Bounding is not validating: a permitted first hop that redirects to `http://169.254.169.254/` must be refused, not followed because the budget allows it.

4. **Byte caps cover the declared length, not the delivered bytes.** `maxContentLength` is applied by the client, but a compressed response can decompress far beyond it. Both the compressed and decompressed sizes need bounding.

5. **Two overlapping modules with no single entry point.** `fetch-policy` and `outbound-fetch-policy` divide the job between them, and callers must know to combine them correctly. That is how call sites end up applying half the policy.

## Required observable behavior

1. **One exported executor is the single approved way to make an outbound request.** Every property below is enforced inside it, so a caller cannot obtain a request that skips them. Build on the existing two modules rather than rewriting their logic — the SSRF rules are already tested elsewhere and must not regress.
2. **The connection goes to the validated address.** Prove the TOCTOU case explicitly: a hostname that resolves to a public address when validated and a private one when connected must not reach the private address. State how the test simulates it. TLS SNI and the `Host` header must still carry the original hostname, so virtual-hosted and TLS endpoints keep working.
3. **Every redirect hop is revalidated against the full policy**, not merely counted. A redirect to a private address, a cloud metadata endpoint, a non-HTTP(S) scheme, or a credentialed URL must be refused at the hop that introduces it. Prove refusal at hop two, not only at hop one.
4. **Both compressed and decompressed sizes are bounded**, and exceeding either terminates the transfer rather than buffering the whole body first. A response that declares a small `Content-Length` and then delivers more must be cut off.
5. **One total deadline covers the whole operation**, including DNS, connection, all redirect hops, and body read — not a per-hop timeout that a chain of slow redirects can multiply. Prove the total, not the per-request, bound.
6. **Attempt metadata is returned and sanitized.** Callers need to know what happened — final URL, status, hop count, bytes read, timing — and that metadata must carry no credentials, no `Authorization` header, and no userinfo. The redaction utility from `p2-redacting-logger` exists for this; reuse it rather than writing a second one.
7. **The highest-risk user-controlled sinks go through the executor.** In scope for migration: `utilities/preview-generator.utility.ts`, `utilities/data-handler.utility.ts`, `utilities/sitemap.utility.ts`, `utilities/calendar-feed.utility.ts`, `utilities/graphql-feed.utility.ts`, `utilities/selector-suggestion.utility.ts`, and `workers/feed-updater.worker.ts`. These take a URL that a feed author controls. Prove each one refuses a blocked target *through its own public entry point*, not by asserting it calls a particular function.
8. **An architecture test prohibits direct network primitives outside approved adapters.** Direct `axios`/`fetch` in `routes/`, `utilities/`, `workers/` and `node/` must fail the test except for an explicit, enumerated exception list. Follow the established pattern in `tests/static-analysis-exceptions-policy.test.ts`. Each exception must carry a reason, and the test must assert the list does not grow — a shrinking list is the mechanism that finishes the migration in later slices.

## Anti-bypass and adversarial requirements

- Do not weaken or duplicate the existing SSRF rules. `isBlockedAddress`, the metadata-hostname block, and allowlist handling are existing behaviour; reuse them.
- Do not satisfy requirement 8 by adding a blanket exception for a whole directory, or by exempting a file that requirement 7 says to migrate.
- The metadata-hostname block must remain absolute — no allowlist entry may re-enable it, including via a redirect.
- Do not implement retry or fallback here; that is a separate slice and mixing it in makes the deadline untestable.
- Credentials in a URL (`https://user:pass@host/`) must be refused, not silently stripped and followed.
- Do not introduce a new HTTP dependency. Axios and `undici`/`fetch` are already present.
- Requirement 2 is the one most likely to be faked. A test that asserts a resolver function was called does not prove the connection went to the validated address; assert the observable outcome.

## Test-author expectations

- Unit and integration tests over the executor, using a local HTTP server on an ephemeral port for redirect, size, and deadline behaviour rather than reaching the internet. No test may make a live third-party request.
- For requirement 2, an injected resolver that returns different answers on successive lookups is the natural approach — the existing policy already accepts a `_dnsLookupFn` seam. Say so if you use it.
- Requirement 7 tests should drive each utility's real entry point with a blocked URL and assert the refusal, so a future refactor that bypasses the executor fails.
- New test files must add ZERO Biome warnings against the locked ceiling of 545 / 13 with zero errors. Traps that have bitten here: a control character in a regex is an **error**, and `${...}` inside an ordinary string is a warning. **Run `bun run verify:static` before reporting**; it has been denied on four consecutive slices — if it is denied again, say so explicitly rather than assuming.
- Run each new test file 6-8 times and confirm the split is identical. Two flaky locked tests have been caught here already.
- Do not modify any file under an existing lock. Twelve slices are locked.

## Notes and open questions for the lead

Flag rather than guess:

- Whether the consolidated executor should be a new module or should absorb one of the two existing ones. Say which the tests assume and why.
- Whether requirement 2 should pin the connection by address for HTTPS as well as HTTP, given the SNI/Host constraint. If there is a case where pinning cannot preserve certificate validation, name it rather than quietly exempting it.
- How many of the 21 direct call sites you believe requirement 8's exception list should still contain after this slice. I expect a non-empty list — the service connectors and browser adapters are separate slices — but it must be enumerated and justified, not open-ended.
