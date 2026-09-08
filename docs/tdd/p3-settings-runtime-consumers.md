# TDD Requirements Brief: `p3-settings-runtime-consumers`

## Ownership

- Roadmap packet and findings: Packet 3, "replace the duplicate setting paths with one typed settings registry containing defaults, validation, secret classification, live-vs-restart behavior, and runtime consumers. Prove save→restart→behavior for every setting." Exit criterion: "settings visibly change enforced runtime behavior."
- Production surfaces owned by this slice: `utilities/app-settings.utility.ts`, `utilities/outbound-fetch-policy.utility.ts` (its `getGlobalFetchPolicyOptions` only), `utilities/fetch-policy.utility.ts` (its `resolveFetchPolicy` env reads only), and any consumer wiring that follows.
- Explicitly NOT in this slice: the Settings *page* frontend (Packet 4), the normalized feed pipeline, browser/FlareSolverr adapters, retry/fallback, proxy/user-agent profiles.
- **The outbound executor contract is frozen and its nine test files are locked.** This slice deliberately touches two functions inside it, because the code's own migration note says to — `outbound-fetch-policy.utility.ts` carries "When Settings Page is implemented, these reads must be replaced with effective settings lookups". Change *only* how those two functions obtain their values. Every locked executor test must still pass unchanged: the policy's behaviour given a set of options is not in scope, only where the options come from.
- Claude-owned test surfaces: `tests/` only.

## Current RED baseline

`bun run verify:core` = **1673 pass / 0 fail** at commit `f65e0d4`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed**. Sixteen test locks verify.

Static gate: **zero errors, 542 warnings, 10 infos** against a locked ceiling of 545/13. Stay at or below 542/10. Three anti-bypass gates count `noExplicitAny`, `noNonNullAssertion` and `as unknown as` and refuse growth; the last greps raw text, so it counts the string inside a **comment** too.

### What is already correct

Stated so the brief does not manufacture work:

- `utilities/app-settings.utility.ts` already *is* a typed registry: `SETTING_REGISTRY` declares each setting's type, default, class (A live / B restart / C env-only), `restartRequired`, and `envVar`.
- `routes/settings.ts` already casts incoming values by declared type, validates, rejects class C writes, and masks class C values on read.
- Retention is already wired end to end: `utilities/worker-manager.utility.ts` reads `getEffectiveSettings` and passes the result to `pruneRunLogs`.

### The defect

**Three declared settings never reach the code that enforces them.** They are in the registry, editable through the API, and stored in `app_settings` — and nothing reads them:

1. `utilities/outbound-fetch-policy.utility.ts`'s `getGlobalFetchPolicyOptions()` builds its options from `process.env.ALLOW_PRIVATE_FETCHES` and `process.env.OUTBOUND_FETCH_ALLOWLIST` directly.
2. `utilities/fetch-policy.utility.ts`'s `resolveFetchPolicy()` reads `env.FEED_RUN_TIMEOUT_MS` from the process environment.

So an operator can set "allow private fetches" in the UI, see it saved, reload the page and see it saved — and the outbound policy will still refuse private addresses, because it never consulted the setting. The setting *appears* to work. That is worse than a missing feature: the UI asserts a security posture the runtime does not implement.

`ALLOW_PRIVATE_FETCHES` in particular decides whether SSRF protection can be relaxed. A control that claims to govern that and does not is the most consequential version of this bug.

## Required observable behavior

1. **Saving a class A setting changes enforced behaviour without a restart.** Prove it end to end: save `allow_private_fetches`, then observe the outbound policy's decision change on the next call, in the same process. Assert the *decision*, not that a getter returns a value.
2. **The allowlist setting reaches the policy.** A host added to `outbound_fetch_allowlist` through the settings path is accepted by the outbound policy afterwards; removing it is refused again.
3. **`feed_run_timeout_ms` reaches the fetch policy.** Changing it changes the deadline the executor applies.
4. **Precedence is explicit and proven.** A stored setting, an environment variable, and the registry default can all supply a value. State the order and prove each level: stored beats env, env beats default. If a class B setting deliberately ignores the stored value until restart, prove that too rather than leaving it implied.
5. **Class C settings never become DB-backed.** `passkey`, `cookie_secret` and `encryption_key` must continue to come from the environment only, must still be rejected on write, and must never appear unmasked in a settings read. This is existing behaviour; prove it does not regress while the plumbing changes around it.
6. **A degraded database does not silently revert security settings to their most permissive value.** If effective settings cannot be read, the outbound policy must fall back to the *safe* default — private fetches disallowed, empty allowlist — not to whatever the environment happens to say and not to a permissive default. State what happens and prove it.
7. **Every locked executor test still passes.** The nine files of `p3-shared-outbound-executor` assert the policy's behaviour given options. This slice changes only where options come from; if a locked test fails, the change is wrong.

## Anti-bypass and adversarial requirements

- Do not satisfy requirement 1 by having the test call the setting getter and assert its return value. The requirement is that *enforcement* changes.
- Do not make settings live by re-reading `process.env` — the environment is not where a saved setting lives.
- Do not widen a type to `any` or add a non-null assertion; two anti-bypass gates count both.
- Do not change the outbound policy's decision logic, only its inputs. `isBlockedAddress`, the metadata-hostname block and redirect revalidation stay exactly as they are.
- Do not cache effective settings so aggressively that requirement 1 becomes false. If you introduce a cache, prove invalidation.
- **Run `bun run verify:static` before reporting.** Denied on eight consecutive slices; if denied again, say so explicitly rather than assuming.
- Run each new test file 6-8 times and confirm the split is identical.
- Do not modify any file under an existing lock. Sixteen slices are locked.

## Test-author expectations

- Integration tests that drive the real settings write path and then the real outbound policy, in one process, against a real temp SQLite database — the same pattern `p3-settings-substrate-reconciliation` established.
- For requirement 6, make the database genuinely unreadable rather than mocking a failure, so the fallback is proven against the real code path.
- Where a setting's effect is a refusal, assert the refusal and its reason, not just that a call threw.

## Notes and open questions for the lead

Flag rather than guess:

- Whether `getGlobalFetchPolicyOptions` should become async (it is currently sync and settings live in SQLite), or whether a synchronously-readable cache refreshed on write is better. Both are defensible; the async change ripples into every caller, the cache needs invalidation. Say which your tests assume and why.
- Whether `feed_run_timeout_ms` is class A or B. It is read per-run, so live seems right, but say what you assume.
- Whether any *other* registry setting has no runtime consumer. I found three; if there is a fourth, name it rather than quietly covering only mine.
