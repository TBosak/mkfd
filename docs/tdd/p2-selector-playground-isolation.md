# TDD Requirements Brief: `p2-selector-playground-isolation`

## Ownership

- Roadmap packet and findings: Packet 2; A1 (`mkfd-audit-aggregate-0526.md:42`) and locked product decision 1 in the roadmap.
- Production surfaces owned by this slice: `routes/utils.ts` (`GET /proxy` and `injectSelectorGadget`), `frontend/src/components/forms/SelectorPlayground.tsx`, a self-hosted SelectorGadget asset, and whatever sanitization module the implementation introduces.
- Explicitly NOT in this slice: protected-value AES-GCM migration, `/configs/*` static serving, app-wide CSP and security headers, container hardening, the redacting logger. Those are separate Packet 2 slices. This slice may set headers on the playground response itself, since that is part of its own isolation.
- Claude-owned test surfaces: `tests/` and `frontend/e2e/` only.

## Current RED baseline

`bun test tests/` = **1220 pass / 0 fail** as of commit `35dfef2`.

Four compounding defects, read from the code rather than the audit summary:

1. **The iframe is same-origin with scripts enabled.** `SelectorPlayground.tsx:151` sets `sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"` on an iframe whose `src` is `/proxy?url=<user-supplied>`, and `routes/utils.ts` returns the *remote page's HTML* from Mkfd's own origin. Any script in the target page therefore executes with full access to the app origin: it can read the DOM, reach `localStorage`, and issue same-origin `fetch` calls to authenticated API routes with the operator's session cookie attached. Pointing the playground at a hostile or compromised page is a complete origin takeover.
2. **SelectorGadget is fetched from an unpinned third-party CDN.** `routes/utils.ts:58` injects `https://dv0akt2986vzh.cloudfront.net/stable/lib/selectorgadget.js` with no integrity attribute and no version pin, into that same-origin document. A CDN compromise, or anyone able to MITM it, gains arbitrary JS execution on the app origin on every playground use. It also makes the feature fail on the air-gapped and LAN installs Mkfd explicitly supports.
3. **`postMessage` is accepted from anywhere.** `SelectorPlayground.tsx:34-42` registers `window.addEventListener("message", ...)` and acts on `event.data.type === "selectorUpdated"` with no `event.origin` check, no `event.source` check, and no nonce. Any frame or opened window can drive the selector value.
4. **FlareSolverr configuration travels in the query string.** `buildProxyUrl()` puts `flaresolverrUrl` and `flaresolverrTimeout` into `/proxy?...`, exposing an internal service URL to browser history, referrer headers, and any request logging.

## Required observable behavior

1. **The playground document must not be able to act as the app origin.** Its iframe must run with `allow-scripts` but WITHOUT `allow-same-origin`, so it is an opaque origin. Prove that a script embedded in the target page cannot read app `localStorage`, cannot reach an authenticated app API with the operator's cookie, and cannot access the parent DOM. Asserting the attribute string alone is insufficient — the behavioural consequence is the requirement.
2. **The served document is sanitized before it reaches the browser.** Scripts, event-handler attributes, `<base>`, forms, and other active content from the target page must be removed or neutralized. Cover inline `<script>`, external `<script src>`, `on*` attributes, `javascript:` URLs, `<base href>`, `<form>`, `<object>`/`<embed>`/`<applet>`, `srcdoc` iframes, and SVG-borne script. Sanitization must not be defeatable by case variation, whitespace or NUL padding inside a tag name, split or nested tags, or HTML entity encoding.
3. **SelectorGadget is self-hosted and integrity-pinned.** It must be served from Mkfd itself, at a pinned version, with an integrity check that fails closed if the asset does not match. No request to a third-party host may occur when the playground is opened. The feature must work with no outbound internet access beyond the target page itself.
4. **The playground response carries a restrictive Content-Security-Policy** that forbids loading scripts from any third-party origin and forbids inline script beyond what the sanitized document itself requires. State the policy as observable behaviour: a third-party script URL in the target page must not load even if sanitization were bypassed, so CSP is a genuine second layer rather than decoration.
5. **`postMessage` traffic is authenticated and schema-validated.** The parent must accept a selector message only when it originates from the exact iframe window it created, and only when the payload carries a per-session nonce the parent generated for that session. The payload must be schema-validated: a selector must be a string within a sane length bound, and anything else is discarded. Prove that a message from a different window, a message with a missing or wrong nonce, and a message with a malformed payload are all ignored.
6. **FlareSolverr configuration no longer travels in the URL.** The playground must be able to use a configured FlareSolverr endpoint without placing its URL, timeout, or any credential in a query string, browser history, or referrer. Both the endpoint and the target URL must still pass the shared outbound policy, and a FlareSolverr URL that fails that policy must be refused.
7. **All 16 selector destinations still work.** They are, exactly: `itemSelector`, `titleSelector`, `descriptionSelector`, `linkSelector`, `enclosureSelector`, `authorSelector`, `dateSelector`, `contentEncodedSelector`, `summarySelector`, `guidSelector`, `categoriesSelector`, `contributorsSelector`, `latSelector`, `longSelector`, `sourceUrlSelector`, `sourceTitleSelector`. A selector chosen in the playground must still land in each one. This is a locked compatibility requirement: the feature is explicitly retained, not removed to close the finding.
8. **The target URL and every redirect still pass the shared outbound policy.** A target that the policy rejects must be refused with the existing 403 behaviour, and the policy must be re-applied on redirect rather than only on the initial URL.

## Anti-bypass and adversarial requirements

- Do not close any finding by disabling, hiding, or removing the Selector Playground. Locked product decision 1 keeps it as a supported v3 feature, and a test must assert the entry point and all 16 destinations still exist.
- `allow-same-origin` must not reappear anywhere in the playground iframe, including via a dynamically constructed attribute.
- The nonce must be per session and unguessable; a test must show a stale nonce from a previous session is rejected.
- Sanitization must be tested with adversarial payloads, not a single well-formed `<script>` tag. Include at least the case-variation, entity-encoded, nested-tag, and attribute-based vectors named in requirement 2.
- The integrity check on SelectorGadget must fail closed. A modified asset must prevent the playground loading, not merely log.
- Do not weaken the outbound policy to make a test pass.
- Do not implement app-wide CSP or security headers here; that is a separate slice. Only the playground response is in scope.

## Test-author expectations

- Integration tests that drive the real `/proxy` route for the server-side behaviour: sanitization, self-hosted asset, CSP header, outbound policy, and the absence of FlareSolverr data in the URL.
- A Playwright test for the browser-side contract, since the origin isolation and `postMessage` authentication are only observable in a real browser. Use the existing authenticated fixture. Assert the opaque-origin consequences behaviourally.
- A structural test for the 16 destinations so the compatibility requirement cannot silently regress.
- Keep tests deterministic: no live third-party network, no reliance on the real cloudfront asset.
- Run the new tests plus the six accepted lock sets. Do not run the full filesystem-mutating suite from the launcher.

## Non-goals

- Rewriting the playground UI or its visual design.
- Replacing SelectorGadget with a different selector tool.
- FlareSolverr adapter hardening beyond keeping its configuration out of the URL and applying the outbound policy; the dedicated adapter is Packet 3/6 work.

## Acceptance checklist

- [ ] The iframe is opaque-origin and a hostile target page provably cannot reach app storage, APIs, or the parent DOM.
- [ ] Sanitization survives adversarial encoding and nesting.
- [ ] SelectorGadget is self-hosted, pinned, integrity-checked, and fails closed.
- [ ] A restrictive CSP is present on the playground response and blocks third-party script.
- [ ] `postMessage` is bound to the exact iframe plus a per-session nonce and is schema-validated.
- [ ] No FlareSolverr configuration appears in any URL.
- [ ] All 16 selector destinations still function.
- [ ] The outbound policy still gates the target and its redirects.
- [ ] Targeted RED command and genuine failure breakdown are reported.
