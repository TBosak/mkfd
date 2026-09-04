# Test Scrutiny Review (round 5 delta): `p1-dependency-ci-security-baseline`

Rounds 1-4 are closed and their corrections must be preserved. Round 4's items 1 and 2 landed correctly: the relative-path reasoning was right, the violating node targets are now in the failure message, and the mobile/desktop nav branching in `basic.spec.ts` and `feeds.spec.ts` is exactly the right shape. Two things remain, and the first is a correction to guidance I gave you.

## 1. My round-4 instruction to "navigate directly to the route" was wrong

I told you that where no mobile nav entry exists, the spec should navigate directly to the route. That does not work, and I should have verified it before asking.

The application has **no SPA deep-link fallback**. `index.ts` serves `/public/*` through `serveStatic({ root: "./" })` and only maps `GET /` to `index.html`; `frontend/vite.config.ts` proxies `/public` to that backend. So any client-side route requested as a URL is served by static file lookup, misses, and returns a bare `404 Not Found` page:

```
Locator: getByRole('heading', { name: 'Feeds', exact: true })
Error: element(s) not found
- text: 404 Not Found
```

That is a genuine product gap — refreshing or bookmarking any page but the root is broken today. I have recorded it for Packets 2 and 3, which own `index.ts` routing and static mounts. **It is not this slice's to fix, and not yours.** Adjust the tests to the application as it actually behaves.

- Required correction: reach every route by **in-app client-side navigation** from the authenticated start page, never by `page.goto()` to a client route. Only the base URL may be fetched directly.
- This applies to `accessibility.spec.ts` and to the `health.spec.ts` / `settings.spec.ts` mobile branches you added in round 4, which currently `goto('health')` / `goto('settings')` and 404.

## 2. Health and Settings have no mobile entry point at all

`frontend/src/components/layout/Sidebar.tsx` is the only place linking `/health` and `/settings`, and it is `lg:`-gated (hidden below 1024 px). `BottomNav.tsx` exposes only My Feeds, a Build Feed button, and Catalog. At 390 px those two pages are therefore genuinely unreachable in the current UI.

This is also a real product gap, recorded for Packet 4 / the UI Redesign Correction Pass. Do not invent navigation, do not reach them through `goto`, and do not widen the mobile viewport.

- Required treatment: keep **all four routes scanned on the desktop project**. On the mobile project, scan the routes that are actually reachable (Builder and My Feeds) and skip Health and Settings with an explicit `test.skip` whose reason names the gap — that no mobile navigation path to the route exists in the current UI, and that Packet 4 owns it.
- The same explicit-reason treatment applies to the `health.spec.ts` and `settings.spec.ts` mobile branches.
- This is the one place a skip is legitimate, because the alternative is asserting against a page the user cannot reach. It is a recorded product gap, not manufactured green. Everything the earlier rounds forbade still stands: no rule exclusions, no impact-threshold lowering, no per-project `testIgnore`/`testMatch`, no widened mobile viewport, no dropped desktop coverage.

## Status of the production side

I fixed the one genuine violation you surfaced. `--muted-foreground` was `204 9% 42%`-worth too light at `47%`, measuring 4.03:1 on `--muted`, 4.22:1 on `--background` and 4.41:1 on white — all under the 4.5:1 AA threshold, and it carries both the sidebar and bottom-nav labels. It is now `42%` (4.85 / 5.07 / 5.31).

**The Builder route now passes axe on both projects.** Preserve that coverage exactly as it is.

## Verification

Rebuild before running the browser suite — the E2E stack serves the built assets from `public/`, not Vite's dev output, so a CSS or component change is invisible until `bun run build` runs.

```
bun run build
bun run test:e2e
```

Report the per-project result. Every browser test must pass on both projects, with the only non-passing entries being the explicitly-reasoned mobile skips for Health and Settings. Then re-run the eight backend slice files and `tests/static-diagnostics-cleanup-architecture.test.ts` to confirm neither regressed.
