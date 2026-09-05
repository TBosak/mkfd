# Test Scrutiny Review: `p2-selector-playground-isolation`

## Verdict

`RETURN TO CLAUDE` — one genuine gap, plus three rulings on ambiguities the draft flagged honestly rather than guessing at.

Independent RED reproduction: **7 pass / 18 fail** across the two backend files, matching the report exactly. Zero Biome warnings on all three new files, the locked 545/13 ceiling holds, `bun run typecheck` is clean (so the Playwright spec compiles under `tsconfig.e2e.json`), and the locked TypeScript-config suite passes.

This is the strongest first draft of the project so far. Three things stand out:

- Origin isolation is proven **behaviourally** — a hostile page cannot read app `localStorage`, cannot reach `window.parent.document`, and cannot call `/api/feeds` with the session cookie — and it carries a **positive control** showing the same fetch succeeds from the real app origin. Without that control the test would pass against a broken app that simply never authenticates anyone.
- Sanitization is genuinely adversarial: case variation, entity-encoded `javascript:`, a split/second `<script>` that defeats a naive single-pass strip, `<base>`, `<form>`, `<object>/<embed>/<applet>`, `srcdoc`, and SVG-borne script, plus a benign-content control so the sanitizer cannot pass by stripping everything.
- The anti-bypass check greps the whole of `frontend/src` for `allow-same-origin` rather than only the component that declares it today, so the attribute cannot reappear elsewhere.

The self-hosted-asset coverage is also right to verify the served bytes hash to the pinned value, rather than just asserting an `integrity=` string is present.

## 1. The nonce contract has no positive path

This is the one real gap, and the draft was right not to invent its way out of it. Requirement 5 asks for a per-session nonce but never said how the parent delivers it, so only the rejection paths could be written. The result is that the suite proves a message is *rejected* in every wrong case but never proves a legitimate one is *accepted* — so an implementation that discards every message, breaking the feature entirely, would pass.

Ruling, stated as a contract rather than internals:

- The parent generates a fresh, unguessable nonce per playground session and delivers it to the playground document when it creates the iframe. The injected script includes that nonce in every `selectorUpdated` message. The parent accepts a message only when it arrives from the exact iframe window it created **and** carries the nonce for the current session.
- Required additions: a **positive round-trip** — a legitimately nonced message from the real iframe updates the selector and can then be assigned to a destination; and a **stale-nonce rejection** — a nonce captured from a previous playground session is refused after the playground is closed and reopened.
- Do not assert how the nonce travels. Query parameter, injected constant, or handshake are all acceptable; the test must observe the contract, not the transport.

Note for the implementation, not the tests: the hostile page inside the opaque iframe can read whatever the parent hands it, so the nonce does not defend against that page — the window-identity check and the opaque origin do. The nonce defends against *other* windows and frames. That is worth knowing so it is not mistaken for a stronger control than it is.

## 2. Rulings on the flagged ambiguities

- **Self-hosted asset location:** confirmed, serve it from `utilsRouter` alongside `/proxy`. `/configs/*` static serving and app-wide headers are separate Packet 2 slices, so keeping the asset on the same router keeps this slice self-contained. Your test's assumption is correct; leave it.
- **Redirect policy status code:** confirmed in scope, and 403 is right. A redirect to a blocked target currently throws and surfaces as 500, which is safe but indistinguishable from a server fault — it hides a security refusal behind an error. Requirement 8 asks for the existing 403 behaviour and for the policy to be re-applied on redirect; keep the test as written.
- **Playwright not executed:** I ran `bun run typecheck` (which covers `tsconfig.e2e.json`) and the locked TypeScript-config suite; both pass, so the spec compiles. Full browser execution will happen against the implementation. No change needed from you.

## Test correctness

- [x] RED is caused by missing behaviour, not setup failure. Independently reproduced at 7 pass / 18 fail.
- [x] Assertions are semantic; the positive controls prevent vacuous passes.
- [x] No live third-party network; the CloudFront check asserts the absence of an outbound call rather than making one.
- [x] Zero new Biome warnings; locked ceiling intact.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only, and self-corrected a lint-baseline regression from three non-null assertions before reporting.

## Feedback for Claude

Add the two nonce tests described in item 1 to `frontend/e2e/selector-playground-isolation.spec.ts`. Change nothing else — items 2 and 3 are confirmations that your existing tests are correct as written, not requests to alter them.

Preserve all 18 genuine RED failures and every adversarial case. Re-run the two backend files plus the six accepted lock sets, confirm zero Biome warnings on all three new files and that the ceiling holds at 545 warnings / 13 infos, and report the breakdown.
