# Test Scrutiny Review (round 2 delta): `p2-csp-security-headers`

Round 1 is accepted and the implementation is complete. One assertion in the browser spec is **unsatisfiable by any implementation**, and it is the only thing left red.

## Where the implementation stands

Backend: all 28 tests across the three `tests/security-headers-*` files pass. Browser: 54 passed, 8 skipped, and exactly one failing test across two projects.

`frontend/e2e/security-headers.spec.ts:109` — `a hostile page embedding the login page in an iframe never sees it render`. Of its two assertions:

- `:148` `expect(frameTitle).not.toBe('Enter Passkey')` — **passes**. Framing is genuinely refused. This was red before the implementation and is green after, so it is doing exactly the job it was written for.
- `:149` `expect(cspViolationMessages.length).toBeGreaterThan(0)` — **fails, and cannot pass.**

## Why `:149` cannot pass

I reproduced the scenario directly in Chromium, outside the suite, capturing every `console` and `pageerror` event without any filtering:

```
frame title: ""
frame url  : chrome-error://chromewebdata/
messages captured: 0
```

The frame is blocked hard — Chromium replaces the document with its own error page — and it emits **nothing** through Playwright's console surface. `frame-ancestors` and `X-Frame-Options` refusals are browser-generated log entries, not console API calls, so they never reach `page.on('console')`. The regex is not too narrow; there are zero messages of any kind to match against.

No `Content-Security-Policy` an implementation could send would produce one. This is not a gap in the header work.

- Required correction: replace `:149` with an assertion on observable state rather than on a log message. The frame's URL is the strong signal — a refused frame lands on a browser error page rather than the framed URL, so `expect(frame?.url()).not.toBe(framedUrl)` proves refusal without depending on logging behaviour. Keep `:148` as-is.
- Do not simply delete `:149` and leave the title check alone. It was there to stop a false "blocked" reading caused by a slow or failed load, and that concern is real — the replacement must still distinguish "refused" from "never loaded for some unrelated reason". The `positive control: the same page loads normally when navigated to directly` test already covers the other half of that, so a URL assertion plus the existing control is sufficient.
- Change nothing else. The other three files and the rest of this spec are accepted.

## For the record: one implementation defect this suite caught

Worth stating because it validates the browser coverage. My first implementation set `Referrer-Policy: no-referrer`, which is in the suite's own `SAFE_REFERRER_POLICIES` set and passed every backend test. In a real browser it broke login outright: `no-referrer` also suppresses the `Origin` header on form submissions, Chrome sends `Origin: null`, and the CSRF guard added in `p2-auth-trust-boundary` rejects it — POST `/passkey` returned 403 in the browser while `curl`, which sets `Origin` itself, still got its 302.

`verify:core` was entirely green throughout. Only the Playwright suite caught it, which is precisely the failure mode CF-09 was filed for. The policy is now `strict-origin-when-cross-origin`.

## Verification

Change only `frontend/e2e/security-headers.spec.ts`. Then run:

```
bun run test:e2e
```

and report the per-project result. The whole suite must reach zero failures. Confirm `bun run verify:static` still reads exactly 545 warnings / 13 infos and `bun run typecheck` is clean.
