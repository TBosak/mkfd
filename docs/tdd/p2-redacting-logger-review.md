# Test Scrutiny Review: `p2-redacting-logger`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` — first round. The third slice running to need no revision.

- Session `63e4f85d-bb8d-4b43-96c1-bd237db010c6` (`claude-sonnet-5`, 72k output tokens; a 17-token `claude-haiku` entry is auxiliary). 138 turns, `is_error: false`.
- Three new files: `tests/log-redaction.utility.test.ts` (491 lines), `tests/log-redaction-call-sites.test.ts` (218), `tests/log-redaction-regression-guard.test.ts` (81).
- CF-05 abort on `feed-state`; slice state file missing (CF-04). Both recovered by me; tests untouched.

**The first attempt at this slice did no work at all.** Session `65d469b7-ec00-4b4e-a694-9ad3a34e5a33` returned `is_error: true` — "You've hit your session limit · resets 3:50pm" — after 40 turns and 9k output tokens, writing nothing. That is the sixth such failure on this project, and the reason `is_error` is checked before anything else: the process exits and the logs look much like a completed run.

Independent RED reproduction: **1406 pass / 8 fail** across `tests/` (1414 total = the 1400 baseline plus 14 new). Per file: `log-redaction.utility` 0 pass / 1 fail (module-load failure — the utility does not exist yet), `log-redaction-call-sites` 3 pass / 4 fail, `log-redaction-regression-guard` 3 pass / 3 fail.

Verified independently: `bun run verify:static` at exactly **zero errors, 545 warnings, 13 infos** across 319 files — notable given the previous slice broke that gate and the author was again denied the command (19 denials, including `bunx tsc`). `bun run typecheck` clean. All eleven existing locks verify. Six consecutive runs of the three files: identical at 6 pass / 8 fail.

## The utility spec has never executed — so I read it

`tests/log-redaction.utility.test.ts` fails to import, which is legitimate pre-implementation RED but means none of its 491 lines have run. Reading it rather than inferring from the failure shape, the coverage is genuinely thorough:

- **Requirement 1** is not satisfied by "secrets vanished". It asserts the top-level key set is preserved, that a redacted request-like object is *still useful for debugging a failed preview*, and explicitly that redaction "does not simply collapse everything to an empty object".
- **Requirement 2** includes `redacts the real axios-shaped defect: preview config with nested headers and proxy` — the actual defect shape, not a toy — plus `only touches the actual sensitive key, not decoy text that merely mentions it`, which is a real anti-over-redaction guard.
- **Requirement 3** is parameterised across all thirteen field names the brief listed, in camelCase, snake_case and kebab-case, plus five capitalisation variants. Not the two tests the outline suggested at a glance.
- **Requirement 4** covers URL userinfo bare, nested, and embedded in a longer message, and — the part I care about — asserts a plain email address is *not* mangled and a URL without userinfo is left alone. Over-eager string rewriting is the obvious way to get this wrong.
- **Requirement 5** covers both the `{ type: "protected", value }` shape and a resolved AES-256-GCM envelope, each nested as well as top-level.
- **Requirement 7** feeds every adversarial input the brief named and several it did not: circular via object *and* via array, `Error` with a `cause`, `Date`, `Map`, `Set`, a function value, 10-deep, thousands-deep, and a 10,000-entry array with a bounded-output assertion.
- Non-mutation is covered both ways: the original is unchanged, and a different object reference is returned.

## Requirement 6 asserts emitted output, as demanded

`log-redaction-call-sites.test.ts` spies on `console.log`/`console.error`, renders the captured arguments the way a console would, and asserts the secret does not appear in that text. That is the difference between proving a secret cannot leak and proving a function was called with certain arguments. It covers a live `Authorization` header, a cookie value, an `apiSpecificHeaders` credential, and secret data carried in a non-string value at the IMAP worker site.

## Requirement 8 is honest about its limits

The regression guard is a static scan over source text, and the file says so in a comment before doing it — a static scan cannot prove the absence of leaks in general. The brief asked for that honesty explicitly, and getting it means the guard will not be mistaken later for stronger evidence than it is.

## Rulings on the three open questions

1. **A `redact()` helper plus fixing the two named defects — not a logger module with a 175-site migration.** The tests assume this and I confirm it. Migrating every `console.*` call is a mechanical change across nearly every file, carrying real regression risk for almost no security gain, since the overwhelming majority log benign progress. The helper is what makes the next risky call site cheap to write safely.
2. **A lint rule banning bare `console.*` is a follow-up, not part of this slice.** It would add warnings against a **locked** ceiling and so cannot simply be switched on here. Filing as a carried finding rather than smuggling it in.
3. **The redaction marker does not distinguish name-matched from value-matched.** A single unambiguous marker is better: the distinction leaks a little about *why* something was redacted, which is a weak oracle, and it gives an operator nothing actionable. The tests use an `isRedactionMarker` predicate rather than hard-coding a literal, so the implementation may choose the exact string.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 1406 pass / 8 fail.
- [x] The never-executed utility spec was read line by line rather than trusted.
- [x] Requirement 6 asserts emitted output, not call shape.
- [x] Assertions guard against over-redaction as well as under-redaction.
- [x] Zero new Biome warnings; ceiling holds at 545 / 13 with zero errors across 319 files.
- [x] `bun run typecheck` clean; all eleven existing locks verify.
- [x] Deterministic across six runs.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only.

The suite is locked and implementation may begin.
