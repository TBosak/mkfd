# Test Scrutiny Review: `p3-settings-runtime-consumers`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` after one narrow revision.

- Session `cca36d0c-248b-473e-91f7-b946341ab4c7` (`claude-sonnet-5`, 73k output over 80 turns, then 9k over 29 for the revision). `is_error: false` both times. 17 permission denials.
- One new file: `tests/p3-settings-runtime-consumers.test.ts`, 25 tests.

Independent RED reproduction: **15 pass / 10 fail**, identical across six runs. Typecheck clean. The nine locked `p3-shared-outbound-executor` files verified unchanged — the check that mattered most, since this slice reaches inside that frozen contract.

## The requirement that could have been faked was not

Requirement 1 is not a getter assertion. `toggling the setting through the real write path flips the policy's decision on the very next call` drives the real settings write and then observes the outbound policy's *decision*. The allowlist and timeout requirements do the same.

Three tests deserve specific credit, none of which the brief asked for:

- **`known cloud metadata hosts stay blocked even after allow_private_fetches is turned on`.** This is the check that stops a live setting quietly becoming an SSRF bypass. It belongs in this slice and I did not think to require it.
- **`an unrelated host is still refused while another host is allowlisted`** — proves the allowlist is a list, not a switch.
- **Requirement 6 asserts the right direction**: `outbound policy stays deny-by-default when app_settings cannot be read, even though env vars ask for true`. Falling back to the environment would have looked like continuity and been wrong. The test makes the database genuinely unreadable rather than mocking a failure.

The author also found a **fourth defect** I had not: `DEFAULT_POLICY.feedRunTimeoutMs` (60000) and `SETTING_REGISTRY.feed_run_timeout_ms.defaultValue` (120000) disagreed, so "the default timeout" had two answers depending on which path you asked.

## Round 2: one `as any`

A single cast on an `axiosGet` stub took `verify:static` from 542 to 543 warnings and the locked anti-bypass count from 416 to 417. Fixed by typing the stub as `AxiosResponse` with `AxiosHeaders`, not by casting it away. Verified independently: zero `as any`, zero `as unknown as`, zero `biome-ignore`, split still exactly 15 pass / 10 fail.

## Rulings on the open questions

1. **`getGlobalFetchPolicyOptions()` stays synchronous.** The author's evidence made this close to a hard constraint rather than a preference: a locked test calls it synchronously with no DB row and expects env fallback, and production call sites use it as a default parameter value, which cannot be awaited. It reads SQLite through bun's synchronous query API.
2. **`feed_run_timeout_ms` is enforced live**, and the registry's default is now the single fallback. `restartRequired: true` governs the Settings UI's messaging, not enforcement — the value is read per-run, so there is nothing to defer.
3. **No fourth setting lacks a consumer.** The three named in the brief were the complete set; retention was already wired through `worker-manager`, and class C is env-only by design.

## Implementation note

The first implementation duplicated the registry's deserializer instead of reusing `parseRawValue`. `string[]` is stored as JSON in the database but comma-separated in an environment variable, and only that function knows both — the duplicate split a JSON array on commas and silently dropped every allowlist entry read from the database. The locked allowlist test caught it. Recorded because writing a second deserializer for one type is precisely the duplication this packet exists to remove, and I did it anyway.

`verify:core` 1698 pass / 0 fail; `test:e2e` 56 passed / 8 skipped / 0 failed; all seventeen locks verify.
