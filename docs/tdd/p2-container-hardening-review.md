# Test Scrutiny Review: `p2-container-hardening`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` after one revision round.

- Session `fae0bd0f-93b0-42f0-b689-feb8223773ed` (`claude-sonnet-5`, 42k output tokens round 1 plus 25k round 2; a 13-token `claude-haiku` entry is auxiliary). 40 turns then 33, `is_error: false` both times.
- One new file: `tests/docker-container-hardening.test.ts`, 56 tests.

Independent RED reproduction: **41 pass / 15 fail** in the new file; **1385 pass / 15 fail** across `tests/` (1400 total = the 1344 baseline plus 56 new). `bun run verify:static` at exactly **zero errors, 545 warnings, 13 infos** across 316 files. `bun run typecheck` clean. All ten existing locks verify. Six consecutive runs of the new file: identical at 41 pass / 15 fail.

## Round 1: strong substance, blocked on the locked static gate

The coverage was right first time and the assertions are not vacuous:

- Requirement 1 does not merely assert a `USER` exists — it asserts the *final* `USER` is not root, that it takes effect before the app runs, and that privileged setup precedes it. Re-escalation is closed off.
- Requirement 3 asserts a **bare** `node_modules` exclusion, which is the actual defect; `node_modules/.cache` would not satisfy it.
- Requirement 6 covers all three secrets symmetrically via `test.each` — what CF-11 needed.
- Requirement 4 also pins the exclusions that already exist (`.git`, `.env`, `configs`, `public/feeds`, `dist`, `build`), so this slice cannot silently regress them.
- No test needs a Docker daemon or the network; it is pure text-contract parsing, as directed. The `curlFlags` helper carries its own unit tests, so a bug in the helper cannot quietly weaken the requirement-7 assertions.

What blocked it: `verify:static` read **1 error and 547 warnings** against the locked zero-errors / 545 / 13, failing two locked tests in `p1-static-quality-contract` and `p1-static-diagnostics-cleanup`. Causes were a literal NUL byte used as a glob sentinel (`lint/suspicious/noControlCharactersInRegex`, error level) and two dollar-brace expressions inside test titles (`noTemplateCurlyInString`, +2 warnings).

**Not the author's fault.** The launcher denied `bun run verify:static`, `bun run lint` and `bunx biome check` on that run — the third slice running with that denial pattern. It had no way to observe the breach it was causing. The invariant still holds, so the suite had to come to it.

## Round 2: accepted

The fix is better than what I proposed. I suggested swapping the NUL for a token sentinel such as `__GLOBSTAR__`; the revision removed the sentinel concept entirely:

```ts
const body = p.split("**").map(escapeGlobSegment).join(".*");
```

Splitting on the literal globstar and rejoining cannot collide with any pattern content at all, whereas a token sentinel is only *unlikely* to. The doc comment states the reasoning. Glob semantics are unchanged — the 15 RED failures and 41 passes are identical to round 1, so no assertion was lost or weakened in the process.

The two titles now describe Compose's `:?` required-variable form in prose, and the regex that actually matches `docker-compose.yml` is untouched:

```ts
const requiredPattern = new RegExp(`\\$\\{${varName}:\\?([^}]*)\\}`);
```

That was the thing I most wanted protected — the lint rule must not be dodged by weakening what is asserted about the deployment file — and it was.

## Rulings on the three open questions

1. **Non-root user: the `bun` user the base image already ships.** No `useradd` needed; selecting the existing user keeps the Dockerfile smaller and avoids inventing a uid that has to be kept consistent with volume ownership on the host.
2. **The digest pin carries a provenance comment.** A pinned digest nobody can re-derive is a maintenance trap, so the `FROM` line must record which tag the digest was resolved from and when, letting a future reader re-verify or refresh it deliberately. The suite asserts the comment exists, which is the right level — asserting a *procedure* in a test would be theatre.
3. **The healthcheck stays on `/` but follows the auth redirect.** This is the ruling I want on record because it avoided scope creep: `/` now answers 302 to `/passkey`, and `curl -f` without `-L` treats that as success, so the check passed against an app that could be entirely broken behind the redirect. Following the redirect makes it distinguish healthy from broken *within this slice's ownership*. Adding a dedicated health endpoint would have been an application change this slice does not own, and it is not needed.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 41 pass / 15 fail.
- [x] Assertions are structural, not line-number dependent, and resist reordering.
- [x] No Docker daemon or network required; helper logic is itself unit-tested.
- [x] Zero new Biome warnings; ceiling restored to exactly 545 / 13 with zero errors.
- [x] `bun run typecheck` clean; all ten existing locks verify.
- [x] Deterministic across six runs.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only.

The suite is locked and implementation may begin.

## Implementation notes

`verify:core` 1400 pass / 0 fail; `test:e2e` 56 passed / 8 skipped / 0 failed; ceiling at 545 / 13 with zero errors; all eleven slice locks verify.

Two things worth recording from implementing against this suite:

- **The base image digest is real, not invented.** `sha256:93b7f5ea...bd799` is `oven/bun:1.2.2-debian` as published 2025-02-01, read from the Docker Hub registry API. The locked test only checks the *shape* of the digest, so a fabricated one would have passed the suite and then broken every real build — worth stating plainly, because a test that cannot tell a true digest from a false one puts the burden back on the implementer.
- **A malformed line continuation nearly shipped.** An escaping slip turned the `chown` `RUN` into `... /app/data \n && chown ...` with a literal backslash-n, which a shell reads as a directory named `n` rather than a continuation. `cat -A` caught it. None of the 56 tests would have: they parse instructions, not shell correctness inside a `RUN` body. That is a real limit of text-contract testing and the reason the byte-level check was worth doing.
