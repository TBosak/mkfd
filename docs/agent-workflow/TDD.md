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
