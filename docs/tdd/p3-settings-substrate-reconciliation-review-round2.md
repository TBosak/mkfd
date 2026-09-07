# Test Scrutiny Review (round 2 delta): `p3-settings-substrate-reconciliation`

The suite is accepted in substance and the implementation is complete against it: **17 of 18 tests pass**. One assertion cannot pass for any correct implementation.

## What is already right

Independent RED reproduction was 6 pass / 12 fail, identical across six runs. `bun run verify:static` held at 542 warnings / 10 infos with zero errors, `bun run typecheck` clean, all fifteen prior locks verifying.

The coverage is thorough and the vacuity traps I flagged were all handled:

- Requirement 1 seeds the dead `settings` table *before* migrating and proves rows are carried into `app_settings`, including the conflict case (live value wins) and the empty-target case — not merely that the table is gone.
- Requirement 5 runs `initDb` twice and `migrate()` twice against real files.
- Requirement 6 seeds at migrations 0000, 0001 and 0002 by applying the real migration files and then runs the real startup path, rather than hand-writing an old schema.
- Requirement 7 **parses the documentation** for the module path and the two function names, then dynamically imports and calls them. Documentation drift fails the test. That is better than what the brief asked for.

The single `:memory:` database is confined to requirement 2, which tests value round-trip fidelity — quotes, newlines, non-ASCII, empty strings. File state is irrelevant there, and the requirements that *are* about file and migration state all use real files under `.tdd-state/`. I checked this rather than assuming it was an oversight.

## The blocker: `:423-424` cannot pass

```ts
expect(res.status).not.toBe(302);
expect(res.headers.get("location")).not.toContain("/passkey");
```

A correct `/readyz` does not redirect, so it emits no `Location` header and `res.headers.get("location")` is `null`. Bun's `toContain` then throws:

> error: Received value must be an array type, or both received and expected values must be strings.

Verified directly against the running server rather than inferred:

```
HTTP/1.1 200 OK
{"ready":true}
```

No `location` header, reachable with no session cookie. The endpoint does exactly what the test's name asks of it, and the assertion fails anyway.

The only way to satisfy the line as written would be to emit a `Location` header on a 200 response, which would be wrong — a `Location` on a non-redirect status is meaningless and would be a defect introduced purely to satisfy a test.

- Required correction: assert the absence of a redirect without dereferencing a header that should not exist. `expect(res.headers.get("location") ?? "").not.toContain("/passkey")` keeps the exact intent and passes only when there is no redirect to the login page. Keep `expect(res.status).not.toBe(302)` as-is.
- Do not weaken the test to only check the status. The point of the pair is that neither a 302 nor a 200-with-a-login-redirect slips through, and that is worth keeping.

## Verification

Change only `tests/p3-settings-substrate-reconciliation.test.ts`, only those lines. Then:

```
bun test tests/p3-settings-substrate-reconciliation.test.ts
```

All 18 must pass against the current implementation. Run it 6 times and confirm the split is identical. Confirm `bun run verify:static` still reads zero errors with warnings and infos at or below 542 / 10.
