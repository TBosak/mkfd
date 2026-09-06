# TDD Requirements Brief: `p2-configs-static-serving-removal`

## Ownership

- Roadmap packet and findings: Packet 2; `/configs/*` static serving.
- Production surfaces owned by this slice: the `/configs/*` static mount in `index.ts`, the `/configs` entry in `frontend/vite.config.ts`, and any replacement access path the implementation introduces.
- Explicitly NOT in this slice: app-wide CSP and security headers, container hardening, the redacting logger. Those are separate Packet 2 slices. The protected-value envelope work is done and locked (`p2-protected-value-aes-gcm`); do not reopen it.
- Claude-owned test surfaces: `tests/` and `frontend/e2e/` only.

## Current RED baseline

`bun run verify:core` = **1299 pass / 0 fail** at commit `685845a`. `bun run test:e2e` = **40 passed / 8 skipped / 0 failed** across 48. Eight test locks verify.

The defect, read from the code:

`index.ts:351` mounts

```ts
app.use("/configs/*", serveStatic({ root: "./" }));
```

which publishes the entire `configs/` directory over HTTP as raw files. Every feed config is a YAML document containing the feed's full definition, its request headers, and its protected values. After `p2-protected-value-aes-gcm` those values are AES-256-GCM envelopes rather than plaintext, so this is no longer a direct credential leak — but it still hands out the complete ciphertext corpus, every `env`-type value's environment-variable **name**, and the internal structure of every feed, in one request per file.

Three things make this worth removing rather than hardening:

1. **Nothing consumes it.** There is no reference to the `/configs` URL anywhere in `frontend/src`, in any route, or in any test. The only other mention is the `/configs` proxy entry in `frontend/vite.config.ts:51`, which exists solely to forward to this mount. Feed configs are already read and written through the authenticated API in `routes/feeds.ts` and `routes/catalog.ts` via `utilities/config-manager.utility.ts`.
2. **It is a second, unaudited path to the same data.** The API applies `maskProtectedValues` before returning a config; the static mount applies nothing. Two paths to the same resource with different disclosure rules is precisely the shape that makes a masking control useless.
3. **`serveStatic({ root: "./" })` is rooted at the repository, not at `configs/`.** The prefix is what confines it. Any normalization difference between Hono's prefix matching and the filesystem resolution turns that into a traversal surface, and the mount earns nothing to offset that risk.

It sits behind the session gate closed in `p2-auth-trust-boundary` — `/configs/*` is not in `ANONYMOUS_ROUTES` — so this is not an anonymous leak. It is an unnecessary raw-file surface available to any authenticated session, and to anything that gets one.

## Required observable behavior

1. **Raw config files are no longer retrievable over HTTP.** A request for a known-existing config under `/configs/` must not return its contents, with or without a valid session. Removal is the expected shape, so a 404 is the natural outcome; assert that the body does not contain the file's contents rather than asserting a specific status alone, so a future "helpful" error page that echoes the path cannot pass.
2. **No path escapes the removed mount.** Requests using traversal sequences, URL-encoded traversal, backslashes, and absolute-looking paths under the `/configs` prefix must not return any file from the repository — in particular not `.env`, `package.json`, or anything under `utilities/`. This must hold on Windows as well as POSIX, since the deployment target is both.
3. **Feed configuration still works end to end through the supported API.** Creating, reading, updating, and deleting a feed must behave exactly as before. This is the compatibility requirement: the slice removes a redundant path, not a feature. Prove it against the real routes, not by asserting the mount is gone.
4. **Protected values stay masked on the surviving path.** A config fetched through the API must still return `********` for `protected` values and must never return a raw envelope. This is what the removed mount bypassed, so it is the requirement that gives the slice its point.
5. **Published feed output is unaffected.** `/public/feeds/*` must remain reachable **without** a session, since it is the product's actual output and is deliberately anonymous. A test must prove the removal did not catch it by accident.
6. **The dev proxy matches production.** `frontend/vite.config.ts` must not forward `/configs` to the backend once the mount is gone, so a developer cannot see behaviour that no deployment has. Note that `/public` must stay proxied — it is what enforces the session gate in the browser suite (see CF-10 and commit `40234cb`); do not remove it while tidying.

## Anti-bypass and adversarial requirements

- Do not satisfy this by moving raw config serving to a different prefix, or by gating it behind a flag that defaults off. The mount goes away.
- Do not weaken or bypass `maskProtectedValues` on the API path to make a test pass.
- Do not add a new route that returns raw config text. If the implementation believes an operator needs raw YAML, that is a product decision and must be raised, not assumed.
- Do not remove `/public/feeds/*` anonymous access while removing `/configs/*`; requirement 5 exists to catch exactly that.
- Do not touch the `/public` or `/vendor` proxy entries in `frontend/vite.config.ts`.
- The traversal cases in requirement 2 must be genuine requests through the app, not unit assertions about a path-normalizing helper.

## Test-author expectations

- Integration tests that drive the real Hono app for requirements 1, 2, 3, 4 and 5.
- Requirement 2 should enumerate several encodings rather than one; `../`, `..%2f`, `%2e%2e%2f`, `..\\`, and a doubled-encoded form are the interesting ones.
- A test asserting the `/configs` proxy entry is absent from `frontend/vite.config.ts` while `/public` and `/vendor` remain, in the style of the existing harness-config tests.
- New test files must add ZERO Biome warnings against the locked ceiling of **545 warnings / 13 infos**. Check with `bun run verify:static` before reporting; if the launcher denies that command, say so in the report rather than guessing.
- Do not modify any file under an existing lock. `frontend/e2e/fixtures.ts`, `tests/e2e-harness-config.test.ts`, and the seven other locked slices are off limits.

## Notes and open questions for the lead

Flag rather than guess:

- Whether any deployment is believed to rely on `/configs/*` for backup or inspection. I am confident nothing in this repository does, but if you find a reference I missed, raise it instead of designing around it.
- Whether the removal should return 404 or let the SPA catch-all handle `/configs/...`. State what the implementation would have to do for your tests to pass either way.
