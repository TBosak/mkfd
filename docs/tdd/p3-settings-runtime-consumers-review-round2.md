# Test Scrutiny Review (round 2 delta): `p3-settings-runtime-consumers`

The suite is accepted in substance. One line breaches a locked gate.

## What is already right

Independent RED reproduction: **15 pass / 10 fail** in `tests/p3-settings-runtime-consumers.test.ts`, identical across six consecutive runs. `bun run typecheck` clean. The nine locked `p3-shared-outbound-executor` files verify unchanged, which is the check that mattered most given this slice reaches inside that frozen contract.

The coverage answers the brief's hardest requirement properly. Requirement 1 is not a getter assertion — `toggling the setting through the real write path flips the policy's decision on the very next call` observes enforcement. The same holds for the allowlist (added host accepted, removed host refused again) and for `feed_run_timeout_ms` (the real retry budget changes).

Three things I want to credit specifically:

- **`known cloud metadata hosts stay blocked even after allow_private_fetches is turned on`.** Nothing in the brief asked for that. It is the check that stops this slice quietly turning a live setting into an SSRF bypass, and it belongs here.
- **`an unrelated host is still refused while another host is allowlisted`** — proves the allowlist is a list, not a switch.
- **Requirement 6 asserts the right thing in the right direction**: `outbound policy stays deny-by-default when app_settings cannot be read, even though env vars ask for true`. Falling back to the environment would have looked reasonable and been wrong; the test pins that the fallback is *safe*, not merely *defined*, and it makes the database genuinely unreadable rather than mocking a failure.

Precedence is covered in all three directions for all three settings, and class C is proven to stay env-only including the atomic-rejection case where a class C key is bundled with a valid class A key.

## The blocker: one `as any` breaches the anti-bypass gate

`tests/p3-settings-runtime-consumers.test.ts:300`:

```ts
axiosGet: async () => ({ status: 500, data: "", headers: {}, request: {} }) as any,
```

That single cast takes `verify:static` from 542 warnings to 543, and the locked `noExplicitAny / noNonNullAssertion diagnostic counts do not increase` test from its ceiling of 416 to 417. The gate is one of the three that has fired on recent slices, and it is right to.

- Required correction: type the stub instead of casting it away. `axiosGet` expects something returning `Promise<AxiosResponse>`, so give the object the fields that type requires — `status`, `statusText`, `data`, `headers`, `config` — and annotate it as `AxiosResponse` rather than `any`.
- Do **not** substitute `as unknown as AxiosResponse`. A different anti-bypass gate counts double casts and would fail instead, and it greps raw text so it would also count the string appearing in a comment.
- Do not add a `biome-ignore`. Do not weaken the assertion the stub supports — the retry-budget test it feeds is one of the requirement-3 proofs.

Nothing else changes.

## Verification

Change only `tests/p3-settings-runtime-consumers.test.ts`, only that line. Then:

```
bun run verify:static
bun test tests/p3-settings-runtime-consumers.test.ts
```

`verify:static` must read zero errors with warnings and infos at or below **542 / 10**. The suite must still be exactly **15 pass / 10 fail** — no proof lost while fixing lint. Run it 6 times and confirm the split is identical. If `verify:static` is denied again, say so and I will run it.
