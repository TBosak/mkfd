# TDD Requirements Brief: `p2-redacting-logger`

## Ownership

- Roadmap packet and findings: Packet 2; redacting logger. This is the **last Packet 2 slice**.
- Production surfaces owned by this slice: a new redaction/logging utility, and the specific call sites named below that log credential-bearing data.
- Explicitly NOT in this slice: migrating all 175 `console.*` call sites in the codebase. That is disproportionate and would touch nearly every file; see the open questions. Application behaviour other than logging is out of scope.
- Claude-owned test surfaces: `tests/` only. Nothing here is browser-observable.

## Current RED baseline

`bun run verify:core` = **1400 pass / 0 fail** at commit `0855527`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed** across 64. Eleven test locks verify. The static ceiling is **545 warnings / 13 infos with zero errors**, and it is locked — three slices have broken it, most recently this one's predecessor.

There are 175 `console.*` calls across `routes/`, `utilities/`, `workers/`, `node/` and `index.ts`. Most log benign progress. Two are genuine defects, and I verified both by reading the code rather than inferring from the grep.

1. **`utilities/preview-generator.utility.ts:238` logs resolved credentials.**

   ```ts
   console.log("Preview Axios Config:", axiosConfig);
   ```

   This is the real leak. Preview generation resolves protected values before building the request, so `axiosConfig.headers` carries live `Authorization` values, and any configured proxy carries its credentials. The whole object is written to stdout on every preview.

2. **`workers/imap-feed.worker.ts:153` logs a variable holding key material.**

   ```ts
   console.error("[IMAP WORKER] Invalid encryption key:", encryptionKey);
   ```

   State this one accurately: the guard above it means the value reaching that line is falsy or not a string, so in practice it prints `undefined`, `null`, `""`, or a non-string. It is not currently dumping a working key. It matters because the pattern is exactly what must never be written — a non-string value could be an object carrying secrets, and a future reordering of the guard would turn it into a live disclosure with no test to catch it.

The codebase already contains the right instinct in one place — `routes/utils.ts:431` logs an IMAP config with `password: config.password ? "[REDACTED]" : undefined` — but it is a hand-rolled, one-off fix that only covers that call site and only that one field. Nothing generalises it, and nothing prevents the next call site from doing what `preview-generator` does.

## Required observable behavior

1. **A redaction utility replaces sensitive values while preserving the shape of the data.** Given an object, it returns one safe to log: secrets replaced with a clear marker, non-sensitive fields intact. Diagnostic value is the point — the log must still tell an operator which host, which feed, which status code. Prove that a redacted object is still useful, not merely empty.
2. **Redaction is structural and recursive, not a regex over a finished string.** It must reach values at any nesting depth, through nested objects and arrays. Prove it on a deeply nested request config, since that is the actual defect.
3. **Sensitive fields are matched by name, case-insensitively, and by common variants.** At minimum: `password`, `passkey`, `token`, `secret`, `apiKey`/`api_key`, `encryptionKey`, `cookieSecret`, `authorization`, `cookie`, `set-cookie`, and proxy credential fields. Matching must be robust to camelCase, snake_case and kebab-case, and to HTTP header names arriving in any capitalisation.
4. **Credentials embedded in strings are redacted too.** A URL of the form `https://user:pass@host/path` must not log its userinfo. This is how proxy credentials actually escape.
5. **Protected values never log their ciphertext or their plaintext.** Both a `{ type: "protected", value: ... }` shape and a resolved AES-256-GCM envelope (a JSON object with `v`/`iv`/`tag`/`ct`, see `utilities/security.utility.ts`) must be redacted. An operator gains nothing from either, and the envelope reveals which values exist and how many.
6. **The two defective call sites are fixed.** `preview-generator.utility.ts:238` must not log resolved credentials, and `workers/imap-feed.worker.ts:153` must not log the key variable. Neither may be fixed by deleting the log outright — both carry real diagnostic value, so they must log a redacted form. Assert the observable behaviour: given a config containing a known secret, the emitted output does not contain it.
7. **The utility is total and never throws.** Logging must not be able to crash a feed update. It must handle `null`, `undefined`, circular references, `Error` instances (preserving message and stack), `Date`, `Map`/`Set`, and very deep or very large structures without infinite recursion or unbounded output. A logger that throws while reporting an error is worse than no logger.
8. **A regression guard stops the pattern reappearing.** Add a check that the known-dangerous call sites stay fixed and that new ones are not introduced in the files this slice touches. Say plainly what it can and cannot catch — a static check over source text cannot prove the absence of leaks in general, and claiming otherwise would be worse than a narrow, honest check.

## Anti-bypass and adversarial requirements

- Do not satisfy requirement 6 by deleting the log statements. Redact and keep the diagnostic.
- Do not redact by stringifying and running a regex over the result; requirement 2 is explicitly structural. A string-level pass may *additionally* catch URL userinfo (requirement 4), but must not be the primary mechanism.
- Do not mutate the caller's object. Redaction returns a copy; a logger that damages the data it logs would corrupt live requests.
- Do not introduce a new logging dependency. `console` plus a redaction helper is sufficient and keeps the container small.
- Do not weaken the locked static ceiling. **Run `bun run verify:static` before reporting**; if the launcher denies it — it denied that command on the previous three slices — say so explicitly in your report rather than assuming the ceiling holds.
- Do not modify any file under an existing lock. Eleven slices are locked.
- Do not change what `routes/utils.ts:431` already redacts; it may be refactored onto the new utility, but the IMAP password must remain redacted either way.

## Test-author expectations

- Unit tests over the redaction utility for requirements 1-5 and 7.
- Integration-style tests for requirement 6 that capture emitted output and assert a known secret does not appear in it — assert on what is written, not on the shape of the call.
- Requirement 7 deserves adversarial input: a circular object, an `Error` with a cause, a 10-deep nesting, an array of 10,000 entries.
- New test files must add ZERO Biome warnings against the locked ceiling of 545 / 13 with zero errors. Note the specific traps that have bitten here: control characters in regexes are an **error**, and `${...}` inside ordinary strings is a warning.
- Run each new test file 6-8 times and confirm the split is identical.

## Notes and open questions for the lead

Flag rather than guess:

- Whether this slice should introduce a `logger` module that call sites migrate to over time, or a `redact()` helper applied at the risky sites. I lean to the helper plus fixing the two named defects, because migrating 175 call sites is a mechanical change with real regression risk and little security gain — but say what your tests assume.
- Whether a lint rule banning bare `console.*` in `routes/`, `utilities/` and `workers/` is worth proposing. Note it would add warnings against a **locked** ceiling, so it cannot simply be switched on in this slice; if you think it is right, describe it as a follow-up for me to route rather than implementing it.
- Whether the redaction marker should distinguish "redacted because the field name matched" from "redacted because the value looked like a secret". Useful for debugging, but it leaks a little about why — say what you propose.
