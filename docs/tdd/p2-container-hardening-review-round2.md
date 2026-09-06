# Test Scrutiny Review (round 2 delta): `p2-container-hardening`

The suite itself is strong and I am accepting its substance. One thing blocks the lock: it breaks the locked static-quality gate, which is a hard project invariant.

## What is already right

Independent RED reproduction: **41 pass / 15 fail** in `tests/docker-container-hardening.test.ts`. The coverage is exactly what the brief asked for, and the assertions are not vacuous:

- Requirement 1 does not merely assert a `USER` exists — it asserts the *final* `USER` is not root, that it takes effect before the app runs, and that privileged setup happens before it. Re-escalation is closed off.
- Requirement 3 asserts a **bare** `node_modules` exclusion, which is the actual defect; `node_modules/.cache` would not satisfy it.
- Requirement 6 covers all three secrets symmetrically via `test.each`, which is what CF-11 needed.
- Requirement 4 also pins the exclusions that already exist (`.git`, `.env`, `configs`, `public/feeds`, `dist`, `build`) so this slice cannot silently regress them.
- No test needs a Docker daemon or the network — it is pure text-contract parsing, as directed. The `curlFlags` helper even has its own unit tests, so a bug in the helper cannot quietly weaken the requirement-7 assertions.

Requirement 7 is resolved within this slice's ownership by asserting the healthcheck follows the auth redirect rather than trusting the 302. That is the right call: it avoids the application change I flagged as out of scope, and I am ruling it accepted rather than carrying it as a finding.

## The blocker: the locked lint ceiling is breached

`bun run verify:static` currently reports **1 error and 547 warnings**, against a locked ceiling of **zero errors / 545 warnings / 13 infos**. Two locked tests fail as a direct result:

- `root and frontend lint halves individually reach zero errors > 'lint:root' exits ...`
- `warning/info diagnostics never exceed the pre-fix baseline > aggregate lint warnings do not exceed ...`

Both belong to `p1-static-quality-contract` and `p1-static-diagnostics-cleanup`. They are accepted locks, so the suite must come to them — they do not move.

This is not carelessness on your part: the launcher denied `bun run verify:static`, `bun run lint` and `bunx biome check` on this run, so you had no way to see it. That is the third slice running where that has happened. The requirement stands regardless, so here is exactly what to change.

### 1. The lint error — a literal NUL byte used as a regex sentinel

In the glob-to-regex conversion around `tests/docker-container-hardening.test.ts:136-138`, `**` is replaced with a literal NUL character (U+0000), which is then matched by a regex on line 138 to expand it to `.*`. Biome rejects control characters in regular expressions under `lint/suspicious/noControlCharactersInRegex`, and this is reported as an **error**, not a warning, so it breaks the zero-errors half of the gate on its own.

- Required correction: use a sentinel that is not a control character and cannot appear in a `.dockerignore` pattern — a token such as `__GLOBSTAR__` works — or restructure the conversion to avoid a sentinel entirely (split on `**`, convert each segment, rejoin). Keep the behaviour identical; the glob semantics being tested are correct.

### 2. Two warnings over the ceiling — `${...}` inside test titles

Lines 500 and 513 embed a literal dollar-brace expression (`${VAR:?message}`) inside ordinary string titles, which trips `lint/suspicious/noTemplateCurlyInString` twice — exactly the +2 that takes 545 to 547.

- Required correction: keep the titles readable without tripping the rule. Writing the form without the surrounding dollar-brace wrapper (for example `VAR:?message requirement`) is the simplest fix. A narrowly-scoped `biome-ignore` with a justification is also acceptable — the file already uses that idiom for `noAssignInExpressions` — but do not add a blanket ignore for the file or the rule.

Do not change the assertions themselves to dodge the lint rules. The dollar-brace **patterns being matched** in `docker-compose.yml` are correct and must stay exactly as they are; only the surrounding title text and the sentinel need to change.

## Verification

Change only `tests/docker-container-hardening.test.ts`. Then:

```
bun run verify:static
bun test tests/
```

`verify:static` must read **zero errors, exactly 545 warnings, 13 infos**. `bun test tests/` must show the two locked static-quality tests passing again, with your 15 genuine RED failures preserved — report the exact split. Run the new file 6 times and confirm the pass/fail split is identical each time.

If `verify:static` is denied again, say so plainly in your report rather than assuming; I will run it.
