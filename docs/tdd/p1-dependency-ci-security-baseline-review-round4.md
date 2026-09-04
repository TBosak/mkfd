# Test Scrutiny Review (round 4 delta): `p1-dependency-ci-security-baseline`

Rounds 1-3 are closed and their corrections must be preserved. Only the items below remain.

`RETURN TO CLAUDE`

The backend suite is fully green (`bun run verify:core`: 0 lint errors at exactly the locked 545/13 ceiling, 0 typecheck errors, 995 pass / 0 fail, catalog validated, build succeeded). The browser suite is not, and three of the four failures classes are test defects rather than production gaps.

`bun run test:e2e` on Windows: **16 passed, 16 failed** across the two projects.

### 1. Accessibility route paths drop the `/public/` base

Three of the four axe tests never reached `AxeBuilder` at all — they timed out in `waitForReady`:

```
My Feeds  getByRole('heading', { name: 'Feeds', exact: true })   element(s) not found
Settings  getByText('Security', { exact: true })                 element(s) not found
Health    getByRole('heading', { name: 'Health Dashboard' })     element(s) not found
```

The cause is the leading slash in `ROUTES[].path`. `frontend/playwright.config.ts` sets `baseURL: 'http://localhost:5173/public/'`, and an absolute path replaces the whole base path: `page.goto('/feeds')` resolves to `http://localhost:5173/feeds`, not `http://localhost:5173/public/feeds`. `feeds.spec.ts` already proves the `Feeds` heading locator itself is correct on desktop, so the locators are not the problem — the URLs are.

- Required correction: make every route path resolve under the configured `baseURL`. Then confirm each `waitForReady` locator against the real rendered page rather than inferring it, and confirm each route reaches `analyze()`.
- Do not work around this by removing `waitForReady`, by lengthening timeouts, or by dropping a route from `ROUTES`. All four routes are required by brief requirement 6.

### 2. The failure message needs the violating nodes

The message names the route, project, rule, impact, and node count, but not *which* elements failed. That is not enough for the lead to act on a real violation without re-running with ad-hoc instrumentation.

- Required correction: include each violating node's target selector (and, where short, its failure summary) in the thrown message, bounded so a large violation set stays readable.
- Reference: brief requirement 6, "include a useful route/project failure message."

### 3. The pre-existing specs do not work under the 390 px project

Eight `chromium-mobile-390` failures come from `basic.spec.ts`, `feeds.spec.ts`, `health.spec.ts`, and `settings.spec.ts`, all failing the same way:

```
locator.click: Test timeout of 30000ms exceeded.
  waiting for getByRole('link', { name: 'Settings', exact: true })
```

This is correct application behavior, not a regression. The desktop sidebar is `lg:`-gated, and below that breakpoint `frontend/src/components/layout/BottomNav.tsx` renders only **My Feeds**, a **Build Feed** button, and **Catalog** — there is no Settings or Health link at 390 px by design.

Adding the 390 px project is this slice's production change, so this slice owns making the browser suite honest under it.

- Required correction: make these specs reach their pages in a way that is valid at both widths — navigate directly to the route where no mobile nav entry exists, and where a mobile nav entry does exist, prefer exercising it so the mobile navigation is genuinely covered. Keep the desktop navigation assertions that exist today; do not delete desktop coverage to make mobile pass.
- Do not solve this with a per-project `testIgnore`/`testMatch` that excludes these specs from the mobile project, with `test.skip` on mobile, or by widening the mobile viewport. Any of those would reproduce exactly the "named project that does not really run" bypass the accepted suite already forbids.

### 4. One genuine production violation — leave it RED

On the Builder route the axe scan did run and found a real defect:

```
Route 'Builder (application shell + /)' (/) on project 'chromium-desktop' has 1 serious/critical accessibility violation(s):
  - [serious] color-contrast: Elements must meet minimum color contrast ratio thresholds (8 node(s))
```

This is a production CSS problem and the lead owns fixing it. Do not exclude the rule, lower the impact threshold, scope the scan away from those nodes, or otherwise soften the gate. Item 2 above exists so the lead can identify the eight nodes.

### Verification note

Playwright's Chromium is now installed locally, so this round can and must be verified by actually running the browser suite — the execution limitation recorded in earlier rounds no longer applies.

Change only files under `frontend/e2e/`. Run `bun run test:e2e` from the repository root and report the per-project result. The four Builder-route colour-contrast failures are expected to remain RED until the lead's CSS fix lands; every other browser test must pass on both projects. Then re-run the eight backend slice files and `tests/static-diagnostics-cleanup-architecture.test.ts` to confirm neither regressed.
