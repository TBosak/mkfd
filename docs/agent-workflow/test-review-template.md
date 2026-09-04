# Test Scrutiny Review: `<slice-id>`

## Verdict

`RETURN TO CLAUDE` or `ACCEPTED FOR IMPLEMENTATION`

## Requirement traceability

Map every requirement and invariant in the brief to the test file and assertion that proves it. Mark gaps explicitly.

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
- [ ] Claude changed test/fixture files only.

## Feedback for Claude

Provide a concise delta from the previous test version. This section is the input to `tdd:claude revise`.
