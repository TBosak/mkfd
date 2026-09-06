# Test Scrutiny Review: `p2-csp-security-headers`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` — first round, no revision required. The second slice running to do so.

- Session `0a50e7ca-a06a-4c08-9d1d-685484d72046` (`claude-sonnet-5`, 79k output tokens; a 19-token `claude-haiku` entry is auxiliary). 123 turns, `is_error: false`.
- Four new files: `tests/security-headers-baseline.test.ts` (343 lines), `tests/security-headers-hsts.test.ts` (112), `tests/security-headers-playground-csp-unchanged.test.ts`, `frontend/e2e/security-headers.spec.ts` (219).
- CF-05 abort on `feed-state`, and the slice state file was missing (CF-04). Both recovered by me; tests untouched.

**The author worked effectively blind.** Nineteen permission denials, covering `bun run verify:static`, `bun run lint`, `bunx tsc --noEmit`, `bun test` on its own new files, `bunx playwright test` on its own new spec, and even `git checkout --` to restore `feed-state`. It could not run a single one of its tests or any quality gate. Everything below is therefore first execution, and the result is better than several suites that were written with full verification available.

Independent reproduction:

- `bun test tests/` = **1330 pass / 14 fail** (1344 total = the 1316 baseline plus 28 new). Split: `security-headers-baseline` 6 pass / 11 fail, `security-headers-hsts` 2 pass / 3 fail, `security-headers-playground-csp-unchanged` 6 pass / 0 fail.
- `bun run test:e2e` = **48 passed / 8 failed / 8 skipped** across 64 (baseline 40 passed / 8 skipped / 0 failed). The 8 failures are 4 distinct tests across 2 projects, covering requirements 2, 3 and 4.
- `bun run verify:static` holds at exactly **545 warnings / 13 infos** across 314 files. `bun run typecheck` clean — so the Playwright spec compiles under `tsconfig.e2e.json` despite never having been run.
- All nine existing locks verify unchanged.
- Six consecutive runs of the three backend files, diffed by test name in a fresh temp directory: identical at 14 fails every time, union 14, intersection 14, **zero flipping tests**.

## The trap was handled correctly

The brief warned that a blanket `frame-ancestors 'none'` would break the Selector Playground, which frames `/proxy` from the app's own origin — a shipped feature a locked slice proves works. This is handled exactly right, and the reasoning goes one step further than I did.

`tests/security-headers-baseline.test.ts` scopes framing control to *non-`/proxy`* responses explicitly, and a whole separate file asserts the locked playground policy is untouched: `GET /proxy through the full app carries exactly the locked directive set — nothing appended, nothing dropped`, plus a check that `frame-ancestors` appears exactly once per response so no second CSP header is emitted alongside the first.

The step further: because that locked file forbids *appending* to `/proxy`'s policy, `/proxy` cannot be given `frame-ancestors 'self'` either — exemption is the only choice compatible with the existing lock. That constraint is real and I had not worked it out when writing the brief.

## Browser-observable requirements are actually observed

The requirements that only mean something in a browser are tested in a browser, behaviourally:

- **Inline script (requirement 2):** creates a `<script>` with `textContent`, appends it, and then asserts on `window.__mkfdInlineExecuted` — whether the browser's own CSP enforcement *let it run*, not whether a header string looks right. The comment correctly notes `page.evaluate` is the harness, not the thing under test.
- **Third-party requests (requirement 4):** subscribes to `page.on('request')` and asserts no request to a foreign host, rather than grepping the HTML for a CDN URL. A grep would pass the moment the `<link>` moved into a stylesheet's `@import`.
- **Framing (requirement 3):** builds a hostile page that embeds the login page and asserts it never renders.

`security-headers-hsts.test.ts` derives HTTPS from the request URL via in-process `app.fetch`, matching the precedent `index.ts:154` set for the `Secure` cookie, and covers both `SSL` startup-flag values from separately-started apps. It also tests a **forged `X-Forwarded-Proto: https` from an untrusted peer**, which is the trust-boundary question the brief did not think to ask.

The requirement-1 loop carries a guard I want to note: it asserts each response body is non-empty and that the four response kinds are genuinely distinct (`id="root"`, `Enter Passkey`, valid JSON, `<rss`). A header-only change that broke a body could not pass by accident.

## Rulings on the three open questions

1. **`style-src 'self' 'unsafe-inline'`; `script-src 'self'` stays strict.** The suite constrains `script-src` hard (no `'unsafe-inline'`, no `'unsafe-eval'`) and deliberately leaves `style-src` unconstrained, which is the honest shape. 33 files under `frontend/src` use React `style={{ }}`, which emits inline `style` attributes; a strict `style-src` would break them. One subtlety the implementation must respect: **do not add a nonce or hash to `style-src`.** Under CSP2+, the presence of a nonce or hash causes `'unsafe-inline'` to be ignored for that directive, which would break every React inline style. A strict `script-src` with a pragmatic `style-src` is a genuine improvement stated honestly; a "strict" policy the app cannot run under would be worse than none.
2. **Replace Pico with a small inline `<style>` on the login page; do not vendor it.** The SelectorGadget precedent vendored an asset because the feature could not work without it. Pico is purely cosmetic for one small form, and vendoring ~80KB plus an integrity pin to style a single page is disproportionate. Inline CSS is already covered by the `style-src 'unsafe-inline'` ruling above, adds no asset to keep pinned, and works air-gapped. The locked contract — title `Enter Passkey`, `input[name="passkey"]` — must not change, and the page must stay legible; the suite asserts all three.
3. **`frame-ancestors 'none'` plus `X-Frame-Options: DENY` everywhere except `GET /proxy`, which is exempt entirely.** As above, exemption rather than `'self'` is forced by the locked playground assertions.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 1330/14 backend and 8 browser failures.
- [x] Assertions are semantic and behavioural where the effect is browser-observable.
- [x] The locked playground CSP is protected by a dedicated file, including against appended directives and duplicate headers.
- [x] No live third-party network; hostile origins are intercepted with `page.route`.
- [x] Zero new Biome warnings; ceiling holds at 545 / 13 across 314 files.
- [x] `bun run typecheck` clean; all nine existing locks verify.
- [x] Deterministic across six runs — union equals intersection.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only.

The suite is locked and implementation may begin.

## Round 2 scrutiny and acceptance

`ACCEPTED — SLICE CLOSED`

- Session `0a50e7ca-a06a-4c08-9d1d-685484d72046` (same session), 16 turns, `is_error: false`. Only `frontend/e2e/security-headers.spec.ts` changed, as directed.
- **Lock refreshed for a test defect, not a relaxation.** The replaced assertion was unsatisfiable by any implementation; the revision asserts strictly more observable state than a console-message check could.

The fix is correct and keeps both halves of the guard:

```ts
anonExpect(frameTitle).not.toBe('Enter Passkey');
anonExpect(frameUrl).not.toBe(framedUrl);
```

The title check alone could be satisfied by a frame that simply never loaded; the URL check distinguishes a genuine refusal — the browser replaces the document with its own error page rather than committing the navigation — and the existing positive control independently proves `/passkey` loads and titles correctly when not framed. Together they can only be explained by framing having been refused.

Verified independently: `bun run test:e2e` **56 passed / 8 skipped / 0 failed** across 64; `bun test tests/` **1344 pass / 0 fail**; `bun run verify:static` exactly **545 warnings / 13 infos** across 315 files; `bun run typecheck` clean; all nine prior locks verify. Six consecutive runs of the spec: 16 passed every time.

This slice's abort was CF-07 rather than CF-05 — the author ran `test:e2e`, which builds first, rewriting `public/assets`. Benign, and excluded from the commit.
