# TDD Requirements Brief: `p2-container-hardening`

## Ownership

- Roadmap packet and findings: Packet 2; container hardening. Also closes **CF-11**, which this slice owes locked coverage.
- Production surfaces owned by this slice: `Dockerfile`, `.dockerignore`, `docker-compose.yml`.
- Explicitly NOT in this slice: the redacting logger, which is the last Packet 2 slice. Application code is out of scope — if a finding here can only be fixed in `index.ts`, raise it rather than fixing it.
- Claude-owned test surfaces: `tests/` only. Nothing here is browser-observable.

## Current RED baseline

`bun run verify:core` = **1344 pass / 0 fail** at commit `dd90c0a`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed** across 64. Ten test locks verify. `tests/docker-frozen-install.test.ts` already exists and is locked under `p1-dependency-ci-security-baseline`; do not modify it, and do not duplicate what it covers.

Six defects, read from the files.

1. **The container runs as root.** `Dockerfile` has no `USER` directive, so the app, the headless Chromium it drives, and every feed fetch run as uid 0. The `oven/bun` base image ships a non-root `bun` user that is simply never selected. A container that mounts `./configs` — which holds every stored credential — and runs a browser against arbitrary attacker-influenced web pages should not also be root.

2. **The host's `node_modules` is copied into the image, over the installed one.** `.dockerignore` excludes `frontend/node_modules` and `node_modules/.cache`, but not bare `node_modules`. The build does `COPY package.json bun.lock*` then `bun install --frozen-lockfile`, and only afterwards `COPY . .` — which overwrites the freshly installed Linux dependency tree with whatever is on the build host. On this project's own development machine that tree is Windows-native, so the image ships binaries that cannot run on the platform it targets, and the `--frozen-lockfile` guarantee that `tests/docker-frozen-install.test.ts` exists to protect is silently discarded at the last step.

3. **Development and runtime state is baked into the image.** `.dockerignore` omits `feed-state/`, `tests/`, and `.tdd-state/`. The last of those holds TDD session artefacts including full model responses. None of it belongs in a published image.

4. **`chmod -R 755 /app/configs`** makes the credential store world-readable inside the container. It exists to make a root-created directory usable; with a non-root user, ownership is the correct mechanism instead.

5. **The base image is pinned by tag, not digest.** `oven/bun:1.2.2-debian` can be repointed at different bytes. The project already took the opposite position elsewhere — `p2-selector-playground-isolation` vendored SelectorGadget and pinned it by SHA-256 rather than trusting a moving URL.

6. **CF-11: the Compose secret requirements have no locked coverage.** `docker-compose.yml` now uses `${VAR:?message}` for `PASSKEY`, `COOKIE_SECRET` and `ENCRYPTION_KEY`, so Compose refuses to start rather than substituting a publicly-known default. Only the `ENCRYPTION_KEY` half is asserted, by `tests/deployment-encryption-key-default.test.ts` under `p2-protected-value-aes-gcm`. The other two were changed by me without a test and must be pinned here.

## Required observable behavior

1. **The container does not run as root.** The image must select a non-root user for the application process. Assert the `Dockerfile` declares it and that the declaration is effective — that it comes after the steps needing elevated privileges and is not overridden later.
2. **Directories the app must write are owned by that user, not world-writable.** `/app/configs`, `/app/extensions` and the runtime data path must be usable by the non-root user without granting broad permissions. Assert ownership or an explicit mode; a blanket recursive `755`, or anything looser, must fail.
3. **`node_modules` never enters the image from the build context.** `.dockerignore` must exclude the root `node_modules` outright, not merely a subdirectory of it. Assert that the dependency tree in the image is the one `bun install --frozen-lockfile` produced.
4. **Development and state directories are excluded.** At minimum `feed-state/`, `tests/`, `.tdd-state/`, and anything already excluded stays excluded. Assert against the `.dockerignore` contract rather than by building an image, so the test is fast and deterministic.
5. **The base image is pinned by digest.** `FROM` must carry an `@sha256:` digest. State the digest's provenance in a comment so a future reader can re-verify it.
6. **Compose refuses to start without each of the three secrets.** For `PASSKEY`, `COOKIE_SECRET` and `ENCRYPTION_KEY`: no `:-` fallback of any kind, no publicly-known literal anywhere in the file, and a `:?` requirement so the failure is at startup with a message. This is CF-11; cover all three symmetrically rather than only the one that already has coverage.
7. **The healthcheck still reports honestly.** `HEALTHCHECK` currently curls `/`, which returns a 302 to `/passkey` now that authentication is real. Verify it still distinguishes a healthy app from a broken one — a check that passes against a server returning any response at all is not a health check. If it does not, that is a finding to report and fix.

## Anti-bypass and adversarial requirements

- Do not satisfy requirement 1 by adding `USER` and then having the entrypoint escalate, or by running the app as a user that owns the whole filesystem.
- Do not satisfy requirement 3 by deleting `node_modules` in a later `RUN` layer; it must never enter the build context, or it remains in the image's history.
- Do not weaken `bun install --frozen-lockfile`, and do not modify `tests/docker-frozen-install.test.ts`, which is locked.
- Do not remove the Chromium/Playwright install to reduce surface; the scraping features depend on it. Locked product behaviour.
- Do not relax any `${VAR:?...}` requirement back to a default to make something start more easily.
- Prefer parsing the `Dockerfile` and `.dockerignore` as text over building an image. A test that requires a working Docker daemon will not run in this environment; if you believe one is genuinely necessary, say so and explain rather than writing a test that silently skips.

## Test-author expectations

- Text-contract tests over `Dockerfile`, `.dockerignore` and `docker-compose.yml`, in the style of `tests/deployment-encryption-key-default.test.ts` and `tests/docker-frozen-install.test.ts`.
- Assertions should be robust to reordering and formatting where that does not weaken them — match on structure, not on an exact line number.
- Requirement 1 needs care: asserting `USER` appears somewhere is weak. Assert it appears, that it is not `root`/`0`, and that no later `USER` re-escalates.
- New test files must add ZERO Biome warnings against the locked ceiling of **545 warnings / 13 infos**. Verify with `bun run verify:static`; if the launcher denies that command, say so in the report rather than guessing — it denied 19 commands on the previous slice.
- Run each new test file several times and confirm the split is identical.
- Do not modify any file under an existing lock. Ten slices are locked.

## Notes and open questions for the lead

Flag rather than guess:

- Which non-root user to select. `oven/bun` images ship a `bun` user; confirm that is what the tests should assume, or propose an explicit `useradd`.
- Whether the digest pin should be accompanied by a documented refresh procedure, since a pinned digest that nobody updates becomes an unpatched base image. Say what you would assert.
- Whether the healthcheck should target a dedicated endpoint rather than `/`. Note that adding one would be an application change, which this slice does not own — so if that is the right answer, it is a finding for me to route, not something to implement here.
