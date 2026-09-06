# Test Scrutiny Review (round 3 delta): `p2-selector-playground-isolation`

Rounds 1 and 2 are accepted. The implementation is complete and committed (`34d4ced`, `c45880a`). All 25 backend tests pass, `verify:core` is green at 1245 pass / 0 fail, and 6 of the 8 browser tests in this spec pass.

Two browser tests fail, and both are defects in the spec rather than in the implementation. I verified each against a real browser rather than inferring from the shape of the failure.

## 1. A blocked cross-origin fetch is scored as a failure

`selector-playground-isolation.spec.ts:178`:

```ts
expect(result.apiBodyLooksLikeFeedJson).toBe(false);
```

Actual result: `undefined`. The two assertions immediately above it **pass** — `localStorage` is unreadable and `parentDomError` is truthy — so the isolation this test exists to prove is working.

`undefined` is not a weaker outcome than `false`; it is a stronger one. `false` means the hostile page issued the request and got something that did not look like feed JSON. `undefined` means the field was never assigned, because the fetch threw before producing a body — the opaque-origin document could not make the call at all. Demanding exactly `false` therefore fails the implementation for being *more* secure than the test anticipated.

- Required correction: accept both outcomes as a pass. Assert the hostile page did not obtain authenticated feed JSON — for example `expect(result.apiBodyLooksLikeFeedJson).not.toBe(true)` — and keep a separate assertion that the request either threw or returned a non-authenticated response, so a genuine leak still fails. Do not simply delete the assertion.

## 2. The positive round-trip posts in the wrong direction

`selector-playground-isolation.spec.ts:289` expects `.legit-choice` and receives `""`.

The test drives the message like this:

```ts
el?.contentWindow?.postMessage({ type: 'selectorUpdated', selector: '.legit-choice', nonce }, '*');
```

That delivers the message **to** the iframe, not from it. The parent's listener requires `event.source === iframeRef.current.contentWindow`, which is only true for a message the iframe itself sent; for a message the parent posts into the iframe, the iframe is the *recipient*. So the parent never sees it, and no implementation satisfying requirement 5 can make this pass.

This is the gap I flagged in round 1 and asked you to close, so the intent is right — only the mechanism is wrong.

- Required correction: have the message originate **inside** the iframe, so `event.source` is genuinely the iframe window. The mocked document you already serve via `page.route` can do this: give it a script that posts `{ type: 'selectorUpdated', selector: '.legit-choice', nonce }` to `window.parent` once it knows the nonce. The stale-nonce test at :292 needs the same treatment for the same reason — check whether it currently passes for the right reason or is merely passing because no message ever arrives.
- Keep the contract transport-agnostic. The nonce still reaches the document by whatever means the implementation chose; only the direction of the `selectorUpdated` message is being corrected.

## Everything else is green

The other six tests in this spec pass against the implementation, including the sandbox-attribute check, the wrong-nonce rejection, the malformed-payload rejection, the foreign-window rejection, and all 16 destinations being present and visible.

For context on the wider suite: the browser run went from 48 failed to 4 failed once an unrelated CSRF/proxy defect was fixed. The remaining 4 are these 2 tests across 2 projects.

## Verification

Change only `frontend/e2e/selector-playground-isolation.spec.ts`. Then run:

```
bun run test:e2e
```

Report the per-project result. The whole suite should reach zero failures. Also confirm the file still produces zero Biome warnings and that `bun run typecheck` stays clean.
