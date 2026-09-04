# Test Scrutiny Review: `p1-cross-platform-e2e-launch`

## Verdict

`RETURN TO CLAUDE`

## Requirement traceability

The first draft meaningfully covers backend POSIX assignment removal, Playwright `env` delivery, generated secret freshness/length, independent overrides, legacy literals, ports/base URL, and CI/local retry/reuse behavior. The targeted command produces 18 intended RED failures and 5 invariant passes.

The following requirements remain incomplete:

- Required behavior 1 applies shell independence to **both** web-server commands; only the backend is checked for shell chaining, and neither command rejects platform-specific shell wrappers.
- Required behavior 5 requires the fixture to use the **exact passkey supplied to the backend**; the current source regex accepts any environment property whose name ends in `PASSKEY`.
- Required behavior 6 forbids checked-in reusable credentials generally; root `dev` checks miss POSIX `PASSKEY=different-value ...` assignments.
- The empty-override adversarial case allows any nonzero subprocess failure with any stderr, rather than a clear deterministic rejection.

## Missing cases or weak assertions

### Frontend command shell chaining

- Missing observable behavior: the frontend command must also contain no shell chaining.
- Counterexample an incomplete implementation could still pass: `command: "bun run setup && bun run dev"` on the frontend entry.
- Required assertion or scenario: apply the shell-chaining assertion to both port 5173 and port 5000 entries.
- Relevant requirement/spec reference: brief required behavior 1.

### Platform-specific shell wrappers

- Missing observable behavior: both commands must be directly cross-platform rather than delegated to a platform-specific shell.
- Counterexample an incomplete implementation could still pass: `bash run-backend.sh` or `sh -c script` contains no leading inline assignment and may contain no chaining character, yet still fails on a normal Windows checkout.
- Required assertion or scenario: reject known platform-specific shell executables/wrappers (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`) while allowing a direct Bun/package-script command.
- Relevant requirement/spec reference: brief required behavior 1 and current C12 failure.

### Exact fixture/backend passkey linkage

- Missing observable behavior: fixture and backend must share the exact E2E passkey contract.
- Counterexample an incomplete implementation could still pass: the fixture reads `process.env.WRONG_PASSKEY`, `process.env.PASSKEY`, or an unrelated `SOMETHING_PASSKEY` while the backend receives the generated/overridden `MKFD_E2E_PASSKEY` value.
- Required assertion or scenario: prove the fixture consumes `MKFD_E2E_PASSKEY` specifically with no hard-coded fallback, and prove that an override is what becomes backend `PASSKEY`. A source-level assertion is acceptable if importing the Playwright fixture behaviorally is impractical, but the variable identity and absence of a literal fallback must be exact.
- Relevant requirement/spec reference: brief required behaviors 4–5 and compatibility invariant for automatic login.

### Alternate inline credentials in root dev script

- Missing observable behavior: the root development command requires external credentials and contains no inline secret assignments regardless of literal value.
- Counterexample an incomplete implementation could still pass: `PASSKEY=new-default COOKIE_SECRET=new-default ENCRYPTION_KEY=new-default bun --watch index.ts` avoids every legacy literal and every command-line flag regex.
- Required assertion or scenario: reject inline assignments for all three secret names in the root `dev` command as well as secret-bearing flags.
- Relevant requirement/spec reference: brief required behavior 6 and H3.

### Clear deterministic empty-override handling

- Missing observable behavior: empty override either regenerates a valid value or fails clearly and deterministically.
- Counterexample an incomplete implementation could still pass: a syntax error, missing import, or random crash returns exit 1 with arbitrary stderr.
- Required assertion or scenario: on the failure branch, require a stable diagnostic across two runs that identifies the affected variable and empty/invalid/required condition; do not accept arbitrary stderr. Continue accepting regeneration as the other conforming behavior.
- Relevant requirement/spec reference: brief empty-string adversarial case.

## Test correctness

- [x] RED is caused by missing behavior, not setup/import/environment failure.
- [x] Existing behavior is not accidentally weakened.
- [x] Most assertions are semantic and specific.
- [x] Mocks/fakes sit at the correct boundary.
- [x] Fixtures are deterministic and contain no real secrets.
- [x] No required case is skipped, marked todo, or snapshot-approved without scrutiny.
- [x] Tests do not over-constrain helper/module layout.
- [x] Claude changed test files only.
- [ ] The incomplete assertions above still allow nonconforming implementations.

## Feedback for Claude

Revise the same test file to close the five gaps above. Preserve the useful existing cases and the targeted subprocess approach. Re-run the narrow test and report the new RED count/reasons. Do not modify production/configuration files.

## Round 2 scrutiny

### Verdict

`RETURN TO CLAUDE`

The first revision closes all five round-1 gaps, but the exact automatic-login contract is still not behaviorally complete.

### Generated default is not proven available to the fixture

- Missing observable behavior: when no `MKFD_E2E_PASSKEY` override exists, the generated passkey supplied to backend `PASSKEY` must also be available as `process.env.MKFD_E2E_PASSKEY` in the Playwright test process.
- Counterexample an incomplete implementation could still pass: the config evaluates `const passkey = process.env.MKFD_E2E_PASSKEY || randomValue`, sets only `webServer.env.PASSKEY = passkey`, and the fixture reads `process.env.MKFD_E2E_PASSKEY`. All current assertions pass, but that variable remains undefined in the Playwright process and automatic login fails.
- Required assertion or scenario: extend the fresh config loader to report the post-import `process.env.MKFD_E2E_PASSKEY` value (without logging it) and assert it equals backend `env.PASSKEY` for both a generated default and an explicit metacharacter override. Apply the same published-value equality to cookie/encryption variables if the implementation contract uses those `MKFD_E2E_*` values as the shared source of truth.
- Relevant requirement/spec reference: required behavior 5 and automatic-login compatibility invariant.

### Fixture reference is not proven to drive the login value

- Missing observable behavior: the exact environment value is passed to `page.fill` for the passkey input.
- Counterexample an incomplete implementation could still pass: a comment or unused declaration mentions `process.env.MKFD_E2E_PASSKEY`, while `page.fill` still receives another variable or a new literal.
- Required assertion or scenario: prove source-level dataflow from `process.env.MKFD_E2E_PASSKEY` to the passkey `page.fill` argument, or use a behavioral fixture test with a fake page. Do not require a particular helper/module layout, but an unused textual reference must not pass.
- Relevant requirement/spec reference: required behavior 5.

### Quoted absolute shell-wrapper path

- Missing observable behavior: platform shell wrappers remain rejected when invoked through a quoted absolute executable path.
- Counterexample an incomplete implementation could still pass: `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -File run.ps1` is split at the first space and the current helper sees `"C:\\Program` rather than `pwsh.exe`.
- Required assertion or scenario: make the assertion recognize a quoted first executable token and reject shell-wrapper basenames in quoted POSIX/Windows paths.
- Relevant requirement/spec reference: required behavior 1 and C12.

Revise only the Claude-owned test file, re-run RED, and report the delta.

## Round 3 scrutiny

### Verdict

`RETURN TO CLAUDE`

The behavioral assertions are now sufficient. One separated-role ownership issue remains.

### Claude must own the E2E fixture change

`frontend/e2e/fixtures.ts` is test harness code under Claude's allowed and exclusive test-author boundary. The accepted suite currently requires that file to change, but leaves it unchanged for the production implementer. Codex may not make that test-side edit after acceptance.

Update `frontend/e2e/fixtures.ts` now so the passkey value actually passed to the passkey `page.fill` call comes from `process.env.MKFD_E2E_PASSKEY`, with a clear failure if the variable is unexpectedly missing and no literal fallback. Do not modify production/config/package files. Then rerun `bun test tests/e2e-harness-config.test.ts` and confirm the fixture-specific cases turn green while the suite remains RED solely on missing production configuration behavior.

The final accepted lock must include both `tests/e2e-harness-config.test.ts` and `frontend/e2e/fixtures.ts` so Codex cannot alter either during implementation.

## Final scrutiny

### Verdict

`ACCEPTED FOR IMPLEMENTATION`

Claude updated the E2E fixture within its exclusive test boundary. The targeted suite now has 36 tests: 17 invariant/test-harness checks pass and 19 production/configuration checks fail for the intended C12/H3 reasons. Requirements, adversarial cases, automatic-login linkage, and role boundaries are adequately specified without prescribing a private production helper layout.

## Post-GREEN quality review

### Verdict

`RETURN TO CLAUDE`

After the production behavior reached GREEN and Windows Playwright passed 12/12, the packet's targeted lint command found two `lint/suspicious/noAssignInExpressions` errors in `fixturePasskeyFillArgumentSourcesFromEnv`, at the two `while ((match = pattern.exec(source)))` loops.

Revise only Claude-owned tests to eliminate both lint errors without weakening or changing the assertions. Run both:

- `bun test tests/e2e-harness-config.test.ts`
- `bunx @biomejs/biome lint frontend/e2e/fixtures.ts tests/e2e-harness-config.test.ts`

Both must pass. Do not touch production/configuration files. The previous lock is expected to fail after this authorized Claude revision and will be replaced only after Codex reviews the new test diff.

## Final post-GREEN acceptance

### Verdict

`ACCEPTED FOR HANDOFF`

Claude replaced only the two assignment-in-expression loops with equivalent `matchAll` iteration. Codex reran the targeted suite (36 passed, 0 failed) and targeted Biome lint (passed). The production behavior and Windows Playwright suite remain green. The revised Claude-owned files may be re-locked.
