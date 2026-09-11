# Test Scrutiny Review: `<slice-id>`

## Verdict

`RETURN TO CLAUDE` or `ACCEPTED FOR IMPLEMENTATION`

## Requirement traceability

Check the test author's compact coverage manifest against the diff. Map every stable requirement/invariant/error ID in the brief to the test file and assertion that proves it. Mark gaps explicitly. Review only the changed portions and unresolved IDs after a revision.

## Missing cases or weak assertions

For each gap:

- Missing observable behavior:
- Counterexample an incomplete implementation could still pass:
- Required assertion or scenario:
- Relevant requirement/spec reference:

Do not prescribe production implementation details and do not edit the tests.

## Test correctness

- [ ] RED is caused by missing behavior, not setup/import/environment failure.
- [ ] Existing behavior is not accidentally weakened.
- [ ] Assertions are semantic and specific.
- [ ] Mocks/fakes sit at the correct boundary.
- [ ] Fixtures are deterministic and contain no secrets.
- [ ] No required case is skipped, marked todo, or snapshot-approved without scrutiny.
- [ ] Tests do not over-constrain a valid implementation.
- [ ] The authorized test author changed test/fixture files only.

## Feedback for the test author

Provide only a concise delta from the previous test version: unresolved requirement ID, counterexample, and missing or over-constrained observable. This is the input to `tdd:claude revise` or the existing Luna task. Do not request formatting or other mechanical cleanup that deterministic tooling or the test author can resolve independently.
