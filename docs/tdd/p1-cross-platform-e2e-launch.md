# TDD Requirements Brief: `p1-cross-platform-e2e-launch`

## Ownership

- Roadmap packet and finding IDs: Packet 1; C12 and H3.
- Feature spec and implementation-plan links: `docs/superpowers/specs/2026-09-02-release-quality-baseline-design.md`; `docs/superpowers/plans/2026-09-02-release-quality-baseline.md`; `docs/mkfd-v3-implementation-roadmap.md` Packet 1.
- Production surfaces owned by this slice: `frontend/playwright.config.ts`, root/frontend package scripts, and a small non-test harness module only if needed to share ephemeral E2E environment values.
- Test surfaces Claude may add or edit: `tests/` and `frontend/e2e/` only.

## Current behavior and RED reason

On Windows, `bun run --cwd frontend test` cannot start the backend because the Playwright command begins with POSIX-only inline assignments: `PASSKEY=... COOKIE_SECRET=... ENCRYPTION_KEY=... bun index.ts`. The same command and the root `dev` script contain reusable committed credentials. `frontend/e2e/fixtures.ts` duplicates the committed passkey.

The new targeted tests must fail against this configuration for the cross-platform/credential-contract reason, not merely because no browser or server is running.

## Required observable behavior

1. Both Playwright web-server commands are executable without POSIX environment-assignment syntax and without shell chaining.
2. The backend web-server receives nonempty `PASSKEY`, `COOKIE_SECRET`, and `ENCRYPTION_KEY` through Playwright's platform-neutral environment mechanism.
3. Default E2E secrets are generated for the current test run, are not fixed literals committed to the repository, and meet current/future-safe entropy and length expectations (at least 32 random bytes for cookie/encryption secrets).
4. An explicit `MKFD_E2E_PASSKEY`, `MKFD_E2E_COOKIE_SECRET`, or `MKFD_E2E_ENCRYPTION_KEY` environment override is preserved exactly so CI can inject controlled values.
5. The authentication fixture uses the exact E2E passkey supplied to the backend and contains no hard-coded passkey.
6. Root development and checked-in Playwright/package configuration contain no reusable passkey, cookie secret, or encryption-key value. Development startup must require external environment/arguments rather than silently supplying credentials.
7. Existing base URL, server ports, CI retry/worker behavior, and reuse-existing-server behavior remain unchanged.

## Required edge and adversarial cases

- Values containing spaces and shell metacharacters are passed as literal environment values, not interpreted as commands.
- One override may be supplied while the other secrets remain generated; overrides are independent.
- Empty-string overrides are not accepted as valid secrets; generate a value or fail clearly and deterministically.
- Two fresh default-environment constructions do not reuse the same generated credential values.
- Tests must not print generated secret values in normal assertion output.

## Compatibility and migration invariants

- E2E login remains automatic through the existing `authenticatedPage` fixture.
- Frontend remains at port 5173, backend at port 5000, and the browser base URL remains `http://localhost:5173/public/`.
- This slice does not change application authentication semantics; Packet 2 owns production auth hardening.

## Non-goals

- Authentication middleware, session, CSRF, or production secret-validation changes.
- Adding mobile or accessibility Playwright projects; those are a later Packet 1 slice.
- Fixing application lint/typecheck failures.

## Test constraints

- No live third-party services and no dependency on an already running Mkfd server.
- Deterministic assertions; generated values are checked by shape/independence, never snapshots.
- Assert configuration behavior and literal preservation rather than a particular private helper layout.
- New required tests must demonstrate RED for the intended reason before implementation.
- Claude may modify only `tests/` and `frontend/e2e/`.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Cross-platform, secret, override, empty, and metacharacter cases are covered.
- [ ] Failure messages identify the violated harness contract.
- [ ] Tests are isolated and deterministic.
- [ ] Targeted RED command and expected failure are stated.
