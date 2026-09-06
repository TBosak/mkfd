# Test Scrutiny Review: `p2-configs-static-serving-removal`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` — first round, no revision required. That has not happened before on this project.

- Session `38b5973d-6ba5-428b-9d4b-9422451ef1df` (`claude-sonnet-5`, 56k output tokens; a 20-token `claude-haiku` entry in `modelUsage` is auxiliary). 80 turns, `is_error: false`.
- One new file: `tests/configs-static-serving-removal.test.ts`, 339 lines, 17 tests.
- The launcher aborted on `feed-state/filesystem/filesystem-test.json` (CF-05) and the slice state file was missing (CF-04). Restored and reconstructed by me; tests untouched.

Independent RED reproduction: **1314 pass / 2 fail** across `tests/` (1316 total = the 1299 baseline plus 17 new). The two failures are the genuinely missing behaviour:

- `requirement 1 ... an authenticated request (valid session) for the same config does not return its contents either`
- `frontend/vite.config.ts dev proxy matches production > the /configs proxy entry is removed now that the mount is gone`

Verified independently rather than from the report: `bun run verify:static` holds at exactly **545 warnings / 13 infos** across 310 files; `bun run typecheck` clean; all eight existing locks verify unchanged. Six consecutive runs of the new file, diffed by test name in a fresh temp directory, are identical at 2 fails — union 2, intersection 2, zero flipping tests. The last slice needed two rounds to reach that; this one arrived there.

## Why 15 of 17 tests passing immediately is correct here, not vacuous

A suite that is 88% green before implementation normally means the tests are not testing anything. I checked each one, because that ratio is exactly the shape a vacuous suite takes.

It is correct here because this slice **removes** a redundant path rather than adding behaviour. The 15 passing tests are compatibility guards — they assert what must *keep* being true after the removal:

- Requirement 2's seven traversal cases pass today because Hono already normalizes them. They are regression guards against a future re-introduction, and they are the reason the mount can be removed confidently rather than hopefully.
- Requirements 3 and 4 (create/read/update/delete through the API, protected values masked) pass today because the API already works. They are the compatibility contract: the slice must not cost a feature.
- Requirement 5 passes today because `/public/feeds/*` is anonymous. It exists to catch the removal accidentally catching the published feed output.

The two tests that fail are precisely the two things that do not exist yet. That is the correct RED for a removal slice.

## What is genuinely good

- **The traversal cases are sent over raw `node:http`, not `fetch`.** The file explains why, correctly: the WHATWG URL parser normalizes literal `..` segments and, for special schemes, folds `\` into `/`, before a `fetch()` request ever leaves the process. A fetch-based traversal test would therefore assert that *the client* sanitizes the path, not that the server does — passing regardless of server behaviour. A real attacker's HTTP client extends no such courtesy. This is the single sharpest thing in the suite and it is the difference between real coverage and a comfortable illusion.
- **Requirement 1 asserts on the body, not just the status.** `expect(body).not.toContain(feedNameMarker)` and `.not.toContain(secretToken)` mean a future error page that helpfully echoes the requested path or file cannot pass. The brief asked for this and it was implemented exactly.
- **The fixture is created through the real API**, so requirement 3's creation path and the `/configs` traversal target share one source of truth. A hand-written YAML fixture could have drifted from what the app actually writes.
- **Requirement 4 rejects raw envelope fields** (`"iv"`, `"tag"`, `"ct"`) as well as the plaintext token, so a regression that leaked ciphertext instead of the mask still fails.
- **The unreachable fixture URL is `http://127.0.0.1:1/...`**, chosen so the background feed worker's fetch fails fast and locally instead of reaching a third-party host. No live network in the suite.
- **Requirement 5 distinguishes a static-mount 404 from an auth-gate redirect**, which is the only way to prove `/public/feeds/*` stayed anonymous rather than merely stayed broken in a different way.

## Rulings on the two open questions

1. **Nothing relies on `/configs/*`.** Confirmed independently: no reference to the `/configs` URL exists in `frontend/src`, in any route, or in any test; the sole other mention is the proxy entry in `frontend/vite.config.ts:51`, which exists only to forward to this mount. Feed configs are read and written through `routes/feeds.ts` and `routes/catalog.ts` via `utilities/config-manager.utility.ts`. Remove it outright.
2. **404 is correct; do not fall through to the SPA catch-all.** The suite's `expect(res.status).not.toBe(200)` accommodates either, but the SPA catch-all would answer 200 with `index.html` for `/configs/anything`, which is a worse answer: it tells a prober the prefix is handled, and it makes the requirement-1 body assertions depend on `index.html` never containing a marker string. A plain 404 is the honest answer for a path that no longer exists. Note that requirement 5's test already asserts `body` does not contain `id="root"`, so an SPA fallback on `/public/feeds/*` would fail — keep that property for `/configs` too.

## One hazard to note, not a blocker

The suite hardcodes `PORT = 5000` and spawns the real server there, matching `tests/auth-trust-boundary.test.ts`. If a stale backend is already listening — the CF-10 situation that corrupted three measurements during the playground slice — `waitForServer` succeeds against the *wrong* process, which holds different secrets.

It fails loudly rather than silently: `login()` throws `Response did not set a session cookie`, or fixture creation throws with a non-200. So it cannot produce a false pass, which is what matters for a locked suite. I am accepting it as-is because an already-locked slice uses the same pattern and changing only this one would be inconsistent; the real fix belongs to CF-10's harness work.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Independently reproduced at 1314 pass / 2 fail.
- [x] Assertions are semantic; the 15 immediately-passing tests are deliberate compatibility guards, each checked individually.
- [x] Traversal coverage is real HTTP through the app, not assertions about a helper.
- [x] No live third-party network; the fixture URL is deliberately unroutable loopback.
- [x] Zero new Biome warnings; ceiling holds at 545 / 13 across 310 files.
- [x] `bun run typecheck` clean; all eight existing locks verify.
- [x] Deterministic across six runs.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only.

The suite is locked and implementation may begin.
