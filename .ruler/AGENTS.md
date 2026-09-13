# Agent Workflow Rules

These rules apply to the entire repository.

## Feature Development Gate (Required)

Before any implementation work begins for a feature:

1. Review corresponding documentation in `docs/features/` for that feature.
2. Review roadmap context in:
   - `docs/features/Mkfd Enhancements Overview.md`
   - `docs/features/Mkfd Release - Review and Plan.md`
3. Create or update a feature spec in `docs/superpowers/specs/`.
4. Create or update an implementation plan in `docs/superpowers/plans/`.
5. Update `docs/superpowers/PROGRESS.md` to reflect spec/plan status.

Implementation code changes are blocked until steps 1-5 are complete.

## Scope Clarification

- The feature spec defines requirements, constraints, security boundaries, and acceptance criteria.
- The implementation plan defines file map, task order, dependencies, and verification strategy.
- If docs conflict, reconcile the conflict in the spec before implementation.

## Roadmap TDD Protocol (Required)

All implementation work from `docs/mkfd-v3-implementation-roadmap.md` uses strict red-green-refactor TDD with separated roles.

### Roles and write boundaries

- **Lead implementer/reviewer:** owns the requirements brief, scrutinizes the tests, returns incomplete tests for revision, implements production code, and verifies the result. The lead must not create, edit, delete, rename, weaken, skip, or re-baseline tests authored for the slice. Codex is the usual lead; when Codex is unavailable, Claude Code takes the lead role under the same constraints.
- **Test author:** Claude Code running **Sonnet 5** is the default sole author and reviser of tests for an implementation slice. Invoke it through `bun run tdd:claude -- author ...` or `bun run tdd:claude -- revise ...`.

  **The invariant is role separation, not model identity.** What must never happen is one agent both authoring a slice's tests and implementing it. Which model fills each seat is an availability question, and it is expected to change mid-project — usage limits on one provider have already interrupted this work repeatedly.

  So: when the default author is unavailable — usage exhausted, provider outage, repeated `is_error` responses — the lead **may substitute an alternate author without new maintainer authorization**, provided all of the following hold:

  - the substitute is a different agent from whoever will implement the slice;
  - it receives the same brief, the same `tests/`-only write boundary, and the same obligation to prove RED and return a compact manifest;
  - every revision for that slice returns to the **same** substitute session or task, never a fresh one;
  - the substitution and its reason are recorded in the slice's ledger row.

  Known alternates, in order of preference: a dedicated GPT-5.6 Luna native Codex task; another Claude Code session explicitly scoped to the test-author role. Do not substitute the agent that will implement the slice, and do not silently switch authors mid-slice — finish the slice with the author that started it, or restart the slice's test phase deliberately and say so in the ledger.
- The test author may write only under `tests/` and `frontend/e2e/`. If a test harness or fixture requires a production/configuration change elsewhere, the test author reports the need and the lead handles it after the tests are accepted.
- The test author must not implement production code. The lead must not repair test-author tests. Test deficiencies always go back to the same test-author session/task with a written delta review.

### Required cycle for every vertical slice

1. Select the smallest independently verifiable vertical slice from one roadmap packet. Do not split one behavior across unrelated packets merely to make the test smaller.
2. The lead creates a concise requirements brief from `docs/agent-workflow/requirements-brief-template.md`. Every meaningful acceptance criterion, invariant, error, boundary, and compatibility obligation gets a stable ID. The brief must cite roadmap/spec sources, security boundaries, v2 obligations, observable behavior, and explicit non-goals without prescribing private implementation.
3. Record the pre-existing baseline for the targeted test command. Existing unrelated failures are not an excuse to skip the cycle.
4. Delegate test authorship with the brief plus only the public interfaces, nearby test conventions, and commands needed for the slice. For Claude Sonnet 5, run `bun run tdd:claude -- author --id <slice-id> --brief <brief-path>`. For a maintainer-authorized Luna substitute, use a dedicated native Codex task. The test author writes tests only, self-reviews, fixes routine test-side defects, runs deterministic checks, proves the narrow RED, and returns a compact manifest mapping requirement IDs to test locations, expected failures, changed files, uncovered requirements, and questions.
5. The lead performs one focused semantic review of the test diff and RED evidence using `docs/agent-workflow/test-review-template.md`. Confirm that the mapped suite enforces the behavioral contract while allowing alternative conforming implementations. Use deterministic tools for formatting, lint, types, and mechanical checks instead of spending lead review on them.
6. If substantive behavior is missing or over-constrained, the lead writes only the unresolved requirement IDs, counterexamples, and required observables. For Claude, run `bun run tdd:claude -- revise --id <slice-id> --brief <brief-path> --feedback <review-path>`; for Luna, send the same delta to the existing task. The test author self-validates the repair. The lead re-reviews only changed portions and unresolved IDs rather than repeating the entire review. The lead does not patch tests directly.
7. Confirm the accepted tests fail for the intended missing behavior rather than syntax, fixture, import, environment, or harness errors. Then lock them with `bun run tdd:tests -- lock --id <slice-id>`.
8. Implement the smallest coherent production change that passes the accepted tests. Do not special-case fixtures, loosen assertions, add test-only production branches, or change the test files.
9. Run the targeted tests until green, classify failures before assigning them, then run packet-relevant deterministic verification. Implementation defects stay with the lead; test defects or newly proven coverage gaps return to the same test author as a minimal delta; the lead resolves specification ambiguity. Run `bun run tdd:tests -- verify --id <slice-id>` before handing off; any test change returns through test-author review.
10. Refactor only while green. Update the implementation ledger/roadmap evidence with the brief, test-author identity/session or task, accepted test diff, RED evidence, GREEN evidence, broader verification, migrations, and remaining risks.

### Test quality gate

Reject and return tests to the test author when they:

- restate implementation details instead of externally meaningful behavior;
- cover only a happy path or merely assert that a function was called;
- omit applicable input boundaries, malformed data, authorization, secret leakage, SSRF/redirect/DNS behavior, cancellation/timeouts, concurrency/restart, accessibility, or v2 round-trip cases;
- use snapshots where precise semantic assertions are required;
- pass before implementation, fail for an unrelated setup reason, depend on live third-party services, time, ordering, or shared mutable state without control;
- weaken existing coverage, introduce `.only`/`.skip`/`.todo` for required behavior, or silently update baselines;
- require a particular internal design when multiple conforming implementations should remain possible.

### Efficient command use

- Use the repository scripts instead of repeatedly reconstructing long commands. See `docs/agent-workflow/TDD.md`.
- Start with the narrowest targeted test; run broader suites only after local GREEN.
- Prefer completion signals that actually wake the lead. Native Luna completion currently updates a mailbox but does not start a new root turn, so use one bounded native wait while a turn is active or temporarily schedule sparse wake-ups; restore the normal roadmap cadence after the handoff completes. The lead must yield while a test author is working and must not continuously poll or repeatedly reread the author's context. Keep routine unchanged checks model-free when possible.
- Do not add a daemon, message bus, workflow engine, or new persistent coordination layer for TDD. Reuse native Codex tasks, the Claude launcher, Git diffs, repository commands, `.tdd-state/`, and the existing lock manifest.
- Store transient test-author session/output and test-lock state under `.tdd-state/`; never paste long transcripts into prompts or commit them.
- Give the test author the concise requirements brief and delta feedback, not the entire audit history or lead conversation. Prefer file paths, requirement IDs, diffs, and line references over whole-file retransmission.
- Use deterministic tests, type checking, linting, static analysis, coverage, or targeted mutation testing when practical. A surviving mutation is evidence to review, not an automatic requirement for another test.

## Notes

- `docs/features/` and `docs/superpowers/` may be ignored by git in this repo; they are still required planning artifacts for local workflow.
