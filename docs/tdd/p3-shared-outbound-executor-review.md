# Test Scrutiny Review: `p3-shared-outbound-executor`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` — first round. The first Packet 3 slice.

- Session `a87bcf8e-5bf1-4e7b-a52a-32d88ca257fd` (`claude-sonnet-5`, **152k output tokens** across 186 turns; a 19-token `claude-haiku` entry is auxiliary). `is_error: false`. The largest run on this project by some margin, which accounts for the ~44 minute duration — long, but the work is there.
- Nine new files, one per migration target plus the executor suite and the architecture test.
- CF-05 abort on `feed-state`; slice state file missing (CF-04). Both recovered by me; tests untouched. 19 permission denials again, the fifth slice running.

Independent RED reproduction: **1489 pass / 17 fail** across `tests/` (1506 total = the 1469 baseline plus 37 new). Per file: executor suite 9 pass / 4 fail, architecture 6 pass / 1 fail, and 2 failures in each of the six migration-target suites bar the two that fail to import.

Verified independently: `bun run verify:static` at exactly **zero errors, 545 warnings, 13 infos** across 329 files. `bun run typecheck` clean. All twelve existing locks verify. Six consecutive runs of all nine files: identical at 20 pass / 17 fail.

**No test touches the internet.** Every host is loopback, a private literal, or a synthetic name; the only non-loopback strings are `10.1.2.3`, `attacker` and `internal.example`, all used with the injected resolver.

## Requirement 2 is the reason to accept this suite

This was the assertion I flagged as most likely to be faked, and it is constructed better than the brief asked for.

The pinning test targets `toctou-pin.mkfd.invalid` — a hostname RFC 2606 reserves so it can *never* resolve in real DNS — while the injected `_dnsLookupFn` returns a loopback address where a real server is listening. The consequence is that an implementation which re-resolves the hostname itself, which is today's defect, **cannot accidentally pass**: it can only fail with a DNS error. The test cannot be satisfied except by genuinely connecting to the validated address.

The rebinding test then asserts the outcome rather than a spy:

```ts
_dnsLookupFn: async () => {
  lookupCalls++;
  return lookupCalls === 1 ? ["127.0.0.1"] : ["127.0.0.2"];
},
...
expect(result.data).toBe("MARKER_SERVER_A");
expect(serverBRequests).toBe(0);
```

Two real servers, and the second is proven never to have been reached. A test that asserted "the resolver was called once" would have been worthless here, and the author knew it.

The same care shows in requirement 3: hop two is a **real, listening** loopback server, so a failure to revalidate is observed directly as its marker appearing in the response body, rather than as a generic error that could have many causes. And the file's header explains that every refused target is chosen to be unreachable even if refusal fails — defence in depth in the test design itself, so a bug in the tests cannot become an outbound request.

## The rest

- **Requirement 4** covers a response declaring a small `Content-Length` and then delivering more, plus a compressed body that expands past the cap, with a sanity control that an ordinary small response still succeeds.
- **Requirement 7** drives real public entry points — `fetchAndBuildSitemapItems`, `resolveDrillChain`, `executeGraphQLFeed`, `suggestSelectors`, `fetchAndBuildCalendarItems`, `generatePreview` and the worker's calendar delegation — not assertions that some function was called. A refactor that bypasses the executor fails these.
- **Requirement 8**'s ledger carries 12 entries, each with a `reason`, none covering a whole directory, and `expect(EXCEPTIONS.length).toBe(12)` pins it so it cannot grow silently. It follows the established `tests/static-analysis-exceptions-policy.test.ts` pattern and notes it could later be promoted to an external document.
- Credentialed URLs are covered twice: refused outright, and refused when introduced by a redirect *without leaking the credential in the error*.

## Rulings on the three open questions

1. **Absorb into `utilities/fetch-policy.utility.ts`; do not add a third module.** The tests import `executeWithFetchPolicy` from there, and that is the right call: two overlapping modules was defect 5 in the brief, and adding a third entry point beside them would make it worse. `outbound-fetch-policy.utility.ts` stays as the policy/validation layer that the executor consumes — one entry point for callers, one place for the SSRF rules.
2. **Address pinning applies to HTTP in this slice; HTTPS pinning is deferred and must be named, not silently skipped.** The locked tests exercise pinning over HTTP only. Pinning an HTTPS connection by address while preserving certificate validation requires driving the TLS `servername` separately from the connection target, which is doable but is a distinct piece of work with its own failure modes. I am ruling it a **carried finding (CF-12)** rather than pretending this slice closes it: for HTTPS the validation still happens and the request still goes out, so this is a narrowing of the gap, not a closure. Recording it honestly is the point — an unstated exemption here would be exactly the kind of thing that reads as done and is not.
3. **Twelve exceptions is the right size for this slice.** They are the FlareSolverr adapter calls, the browser-automation paths and the service connectors — all explicitly separate Packet 3 slices. The pinned count is what turns "we will migrate the rest later" into a checkable claim.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 1489 pass / 17 fail.
- [x] Requirement 2 asserts the connection outcome, not resolver invocation, and cannot pass by accident.
- [x] Redirect revalidation is proven at hop two against a real listening server.
- [x] Migration tests drive real public entry points.
- [x] No live third-party network request anywhere in the suite.
- [x] Zero new Biome warnings; ceiling holds at 545 / 13 with zero errors across 329 files.
- [x] `bun run typecheck` clean; all twelve existing locks verify.
- [x] Deterministic across six runs.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only.

The suite is locked and implementation may begin.
