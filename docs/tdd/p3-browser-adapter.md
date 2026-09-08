# Slice brief: `p3-browser-adapter`

**Packet 3** — the browser half of the roadmap's adapter bullet (line 205):

> Put browser automation and required FlareSolverr support behind explicit adapters
> with separately documented trust/egress controls. … **intercept browser subresources**,
> enforce total budgets … Prohibit direct `fetch`, Axios, FlareSolverr posts,
> **or browser navigation** outside approved low-level adapters with an architecture test.

The FlareSolverr half landed in `p3-flaresolverr-adapter` (commit `d5e8fe6`). This
slice is the browser half.

---

## Baseline to prove against

Measured at commit `d5e8fe6`, immediately before this slice:

| Gate | Value |
|---|---|
| `bun run verify:core` | **1728 pass / 0 fail** |
| lint | **540 warnings / 10 infos**, zero errors (ceiling: 545/13) |
| `bun run test:e2e` | **56 passed / 8 skipped / 0 failed** |
| locks | all **eighteen** verify |

New test files must add **zero** Biome warnings. Three prior slices broke that.

---

## The situation

Three places launch a browser, and all three are the same block copied:

| Site | Lines |
|---|---|
| `utilities/data-handler.utility.ts` | ~221 (drill-chain root), ~339 (drill-chain steps) |
| `utilities/preview-generator.utility.ts` | ~92 |
| `workers/feed-updater.worker.ts` | ~333 |

Each does: `chromium.launch(getChromiumLaunchOptions(...))` → `newContext({ userAgent })`
→ `addInitScript` hiding `navigator.webdriver` → `newPage()` → `page.goto(url, { waitUntil: "networkidle", timeout: 10000 })`
→ `page.content()`.

Three defects follow from that shape.

### 1. Subresources are not intercepted at all — the stated requirement

`page.goto` is the only URL any policy has ever seen. Once the document loads, the
page pulls images, scripts, stylesheets, fonts and XHR from wherever its markup
says, and **none of that goes through `assertAndResolveOutboundTarget`**. A scraped
page can carry `<img src="http://169.254.169.254/latest/meta-data/">` or an XHR to
`http://127.0.0.1:8080/admin` and the browser will fetch it. Every outbound guard
this project has built is bypassed by one tag in untrusted markup.

This is the concrete meaning of "intercept browser subresources".

### 2. Drill-chain steps navigate to scraped URLs with no validation whatsoever

`data-handler.utility.ts:339` navigates to `absoluteUrl` — a URL **extracted from
the previous page's HTML**. The non-advanced branch a few lines below routes the
same value through `axiosGetWithPolicyRedirects`, and the FlareSolverr branch now
routes it through the adapter, which validates. The advanced branch validates
nothing. The attacker-controlled input is the scraped document itself.

### 3. Two budget defaults that do not reconcile

`chromium.launch` gets `timeout: 60000` and `page.goto` gets `timeout: 10000`,
both hardcoded, while every other outbound path in the codebase now derives its
budget from `resolveFetchPolicy(feedConfig).feedRunTimeoutMs`. There is no total
budget across a drill chain: ten steps at ten seconds each is a hundred seconds
regardless of what the feed's policy says.

---

## What to build

A single adapter, `lib/outbound/browser-adapter.ts`, placed outside the scanned
directories for the same reason `pinned-request.ts` and `flaresolverr-adapter.ts`
are — it *is* the approved low-level primitive, so the architecture test must not
flag it. It is the only place in the codebase that may call `chromium.launch` or
`page.goto`.

Shape (adjust names if the tests argue for better ones):

```ts
export interface BrowserFetchRequest {
  url: string;
  policyOptions: OutboundFetchPolicyOptions;
  budgetMs: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: Array<{ name: string; value: string }>;
}

export interface BrowserSession {
  navigate(url: string): Promise<string>;  // validated per call; returns HTML
  close(): Promise<void>;
}

export function openBrowserSession(req: BrowserFetchRequest): Promise<BrowserSession>;
export function fetchWithBrowser(req: BrowserFetchRequest): Promise<string>;
```

A session type exists because the drill chain genuinely needs one browser across
many navigations; `fetchWithBrowser` is the one-shot form the preview and worker
paths want.

### Requirements

1. **Every navigation is validated.** `navigate()` runs the target through
   `assertAndResolveOutboundTarget` on *each* call, not once at session open.
   The drill chain's second and tenth steps are as untrusted as its first.

2. **Every subresource is validated.** Install a `context.route("**/*", …)` handler
   that runs each intercepted request's URL through the same policy and **aborts**
   the ones it refuses. The main document request is validated too — belt and
   braces with (1), since the request handler sees redirects the `goto` call does
   not.

3. **A refused subresource does not fail the page.** Aborting one image must leave
   the document usable; the page's own content is what the caller wants. Refusals
   are counted and reported on the session so a caller can log them, and logged
   once per navigation rather than per request.

4. **Redirects are revalidated.** A permitted first hop that redirects to a private
   address must be refused at the hop that introduces it — matching what
   `axiosGetWithPolicyRedirects` already does.

5. **One budget bounds the whole session.** `budgetMs` is a deadline for the
   session, not a per-navigation timeout: a drill chain that has spent its budget
   fails its next `navigate` rather than starting a fresh ten-second clock. The
   launch timeout comes out of the same budget.

6. **The browser always closes.** Every current site closes in the happy path only;
   a throw between launch and `close()` leaks a Chromium process. The session must
   close on error, and `data-handler`'s existing `finally` should end up delegating.

7. **A static guard**, in the shape of `tests/flaresolverr-adapter-static-guard.test.ts`:
   no `chromium.launch`, `browser.newPage`, or `page.goto` may appear in
   `routes/`, `utilities/`, `workers/`, `node/` outside the adapter. This is what
   keeps the invariant true after the slice ends.

### Migrate all four call sites

`data-handler` (both), `preview-generator`, `feed-updater.worker`. Behaviour that
must survive: the `navigator.webdriver` init script, the random user agent, the
per-feed extra headers, the cookie injection with its hostname-derived domain, and
the "networkidle timed out, use the current page state" tolerance — that last one
is deliberate and load-bearing, not a bug.

---

## Explicitly out of scope

- Anything about `getChromiumLaunchOptions` or the extension-loading path; it keeps
  working, it is just called from one place instead of three.
- Proxy and user-agent *profiles* — that is its own Packet 3 bullet.
- Retry and fallback behaviour — likewise its own bullet.
- CF-12 (HTTPS address pinning). The browser cannot pin the way the axios path
  does, and pretending otherwise here would overstate what this slice delivers.

---

## Notes for the test author

- **Do not launch a real Chromium in these tests.** Patchright's launch is slow and
  environment-dependent, and the suite runs on two OSes. Inject a browser factory,
  or mock the `patchright` module, and assert on what the adapter *asked* the
  browser to do — which URLs were validated, which route handler verdicts were
  `abort` vs `continue`.
- The interesting cases are: a subresource to a private address is aborted while
  the document still renders; a drill-chain second navigation to a metadata IP is
  refused; a redirect from a public URL to a private one is refused at the hop; a
  session past its deadline refuses to navigate; and a throw mid-navigation still
  closes the browser.
- The static guard must not flag `lib/outbound/browser-adapter.ts` itself, and must
  not flag test files.
- One `as any` will breach the anti-bypass gate. So will the literal string
  `as unknown as` **anywhere in the file, including a comment** — that has now
  cost two slices.
