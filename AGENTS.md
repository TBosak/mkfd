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

- **Lead implementer/reviewer:** Codex owns the requirements brief, scrutinizes the tests, returns incomplete tests for revision, implements production code, and verifies the result. The lead must not create, edit, delete, rename, weaken, skip, or re-baseline tests authored for the slice.
- **Test author:** Claude Code running **Sonnet 5** is the sole author and reviser of tests for an implementation slice. Invoke it through `bun run tdd:claude -- author ...` or `bun run tdd:claude -- revise ...`; do not substitute another Claude model or another agent.
- Claude may write only under `tests/` and `frontend/e2e/`. If a test harness or fixture requires a production/configuration change elsewhere, Claude reports the need and the lead handles it after the tests are accepted.
- Claude must not implement production code. The lead must not repair Claude's tests. Test deficiencies always go back to the same Claude session with a written review.

### Required cycle for every vertical slice

1. Select the smallest independently verifiable vertical slice from one roadmap packet. Do not split one behavior across unrelated packets merely to make the test smaller.
2. The lead creates a requirements brief from `docs/agent-workflow/requirements-brief-template.md`. It must cite the roadmap IDs, specs, security boundaries, v2 compatibility obligations, observable behavior, and explicit non-goals.
3. Record the pre-existing baseline for the targeted test command. Existing unrelated failures are not an excuse to skip the cycle.
4. Run Claude Sonnet 5 with `bun run tdd:claude -- author --id <slice-id> --brief <brief-path>`. Claude writes tests only and runs the narrowest useful command to prove RED.
5. The lead reviews the test diff and failure output using `docs/agent-workflow/test-review-template.md`. Confirm requirement traceability, meaningful assertions, determinism, correct test level, and relevant happy, failure, boundary, migration, security, concurrency, cancellation, accessibility, and v2-compatibility cases.
6. If anything is missing, the lead writes review feedback and runs `bun run tdd:claude -- revise --id <slice-id> --brief <brief-path> --feedback <review-path>`. Repeat until the tests fully specify the slice. The lead does not patch tests directly.
7. Confirm the accepted tests fail for the intended missing behavior rather than syntax, fixture, import, environment, or harness errors. Then lock them with `bun run tdd:tests -- lock --id <slice-id>`.
8. Implement the smallest coherent production change that passes the accepted tests. Do not special-case fixtures, loosen assertions, add test-only production branches, or change the test files.
9. Run the targeted tests until green, then the packet-relevant verification command. Run `bun run tdd:tests -- verify --id <slice-id>` before handing off; any test change returns the slice to Claude review.
10. Refactor only while green. Update the implementation ledger/roadmap evidence with the brief, Claude session ID, accepted test diff, RED evidence, GREEN evidence, broader verification, migrations, and remaining risks.

### Test quality gate

Reject and return tests to Claude when they:

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
- Store transient Claude session/output and test-lock state under `.tdd-state/`; never paste long transcripts into prompts or commit them.
- Give Claude the requirements brief and delta feedback, not the entire audit history. Link to source documents and include only the relevant acceptance criteria.

## Notes

- `docs/features/` and `docs/superpowers/` may be ignored by git in this repo; they are still required planning artifacts for local workflow.
