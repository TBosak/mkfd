# Mkfd v3 TDD Operating Procedure

This procedure implements the mandatory workflow in `AGENTS.md`. It exists to keep handoffs short, reproducible, and resistant to test/implementation role drift.

## One slice, one brief, one Claude session

Use a stable lowercase slice ID such as `p3-v2-css-target-roundtrip`. Create its brief from `requirements-brief-template.md`. The Claude launcher stores the session ID and last response under `.tdd-state/`, allowing precise feedback to return to the same Sonnet 5 session without resending repository history.

```powershell
bun run tdd:claude -- author --id p3-v2-css-target-roundtrip --brief docs/tdd/p3-v2-css-target-roundtrip.md
```

The lead then reviews the test diff and RED output. When coverage is incomplete, record only the gaps and required observable behavior in a review file:

```powershell
bun run tdd:claude -- revise --id p3-v2-css-target-roundtrip --brief docs/tdd/p3-v2-css-target-roundtrip.md --feedback docs/tdd/p3-v2-css-target-roundtrip-review.md
```

Reuse `revise` until the tests pass scrutiny. Do not start implementation while review feedback remains open.

## Running the Claude launcher (long jobs)

A `tdd:claude` author or revise run takes roughly 18 minutes. That is longer
than any agent tool timeout permits, so the lead must not wait on it inline.

**Do not block, and do not poll in a loop.** Launch the run detached, schedule
your own return, and end the turn:

1. Start it detached with output redirected to a log, capturing the PID. On
   Windows:

   ```powershell
   $log = ".tdd-state\<slice>-<phase>.log"
   $p = Start-Process -FilePath "bun" `
     -ArgumentList 'run','tdd:claude','--','author','--id','<slice>','--brief','<brief>' `
     -WorkingDirectory "<repo>" -RedirectStandardOutput $log `
     -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
   ```

2. Schedule a one-shot wake-up about 20 minutes out. Its prompt must be
   self-contained: the PID, both log paths, what the run was for, and what to
   do with the result.
3. End the turn. On waking, check the PID first. If it is still running,
   schedule another short check rather than blocking.

**Never pass a Bash tool timeout above 600000 ms.** The documented maximum is
600000; three consecutive long runs were silently killed by passing 900000, and
the symptom looks like an external process kill rather than a bad argument.

### Recovering a run the launcher aborted

The launcher regularly throws *after* Claude has already responded and written
its tests. The usual cause is the test suite rewriting tracked runtime state
(`feed-state/filesystem/filesystem-test.json`), which the boundary check reads
as Claude editing production files. The authored tests are still valid.

When `.tdd-state/<slice>.json` is missing:

1. Reconstruct it from `.tdd-state/<slice>-last-response.json`, which carries
   `session_id` and the model identity. Preserving the session id is what lets
   `revise` continue in the same Claude session, as the protocol requires.
2. Restore the runtime-state file: `git checkout -- feed-state/filesystem/filesystem-test.json`.
3. Continue with the lead review.

Do not re-run `author` to recover state. It starts a new session, discards the
review history, and costs another full run.


## Lock accepted tests before implementation

```powershell
bun run tdd:tests -- lock --id p3-v2-css-target-roundtrip
```

After production implementation and targeted GREEN:

```powershell
bun run tdd:tests -- verify --id p3-v2-css-target-roundtrip
```

Verification fails if any accepted test was added, removed, renamed, or changed. If a requirement genuinely changes, update the brief and send the test change back through Claude; create a new lock only after review.

## Verification commands

Prefer the smallest command that proves the current step:

```powershell
# One backend test file
bun test tests/example.test.ts

# One Playwright file
bun run --cwd frontend test -- example.spec.ts

# Static checks
bun run verify:static

# Backend tests, catalog validation, static checks, and production build
bun run verify:core

# Core verification plus browser tests
bun run verify:full
```

Packet 1 owns making these commands fully green and deterministic on Windows and Linux. Before that baseline is repaired, capture unrelated pre-existing failures explicitly and still prove the targeted RED/GREEN transition.

## Lead review standard

The lead reviews behavior, not line count. Every requirement in the brief needs at least one meaningful assertion, and every material risk needs an adversarial or boundary case at the correct test level. Unit tests should isolate pure contracts; integration tests should cross serialization, persistence, process, or network-policy boundaries; Playwright tests should exercise user-visible behavior and accessibility.

The lead returns tests to Claude when the suite can pass with a materially incomplete implementation. Feedback should name the missing observable, give one or more counterexamples, and explain the incorrect behavior that the current suite would allow. It should not prescribe production internals.

## Evidence retained per slice

The implementation ledger records only compact evidence:

- slice ID and roadmap/spec links;
- requirements brief path;
- Claude Sonnet 5 session ID from `.tdd-state/<slice-id>.json`;
- accepted test files and review outcome;
- targeted RED command and relevant failure summary;
- targeted GREEN command and result;
- broader verification command and result;
- migration/compatibility notes and remaining risks.

Claude transcripts and lock manifests remain transient under `.tdd-state/` and are not committed.
