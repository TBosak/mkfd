# TDD Requirements Brief: `p2-protected-value-aes-gcm`

## Ownership

- Roadmap packet and findings: Packet 2; S5 protected-value encryption.
- Production surfaces owned by this slice: `utilities/security.utility.ts`, `utilities/protected-values.utility.ts`, the startup secret validation in `index.ts` (`getSecrets`), the `ENCRYPTION_KEY` default in `docker-compose.yml`, and whatever migration entry point the implementation introduces.
- Explicitly NOT in this slice: `/configs/*` static serving removal, app-wide CSP and security headers, container hardening beyond the `ENCRYPTION_KEY` default, the redacting logger. Those are separate Packet 2 slices.
- Claude-owned test surfaces: `tests/` only. No Playwright test is expected here; nothing in this slice is browser-observable.

## Current RED baseline

`bun run verify:core` = **1245 pass / 0 fail** at commit `40234cb`. The three crypto-adjacent suites (`tests/protected-values.test.ts`, `tests/sensitive-config.test.ts`, `tests/protected-value-cast-boundary.test.ts`) = **50 pass / 0 fail**. `configs/` is empty on this machine, so migration coverage must construct its own fixtures rather than depend on existing stored feeds.

Five defects, read from the code rather than from the audit summary.

1. **The cipher is unauthenticated.** `security.utility.ts` uses `AES-CBC` with no MAC. Ciphertext is malleable: an attacker with write access to a stored config can flip bits in the IV to control the first plaintext block, and CBC padding behaviour distinguishes valid from invalid padding. `decrypt` reports failure only when the padding check happens to fail, so tampering frequently yields silently wrong plaintext instead of a refusal. Any secret stored by Mkfd — proxy credentials, IMAP passwords, service-connector tokens — is affected.

2. **`decrypt` corrupts the plaintext.** The final line is `return plainText.trim()`. Every decrypted secret loses leading and trailing whitespace. A password that legitimately begins or ends with a space is silently returned wrong, and the failure surfaces far away as an authentication error against a third-party service. This is a data-integrity defect independent of the cipher choice, and it must not survive the migration.

3. **A short or malformed key is accepted silently.** `forge.util.createBuffer(encryptionKey, "utf8").getBytes(32)` returns however many bytes are available. A four-character key yields a four-byte key rather than an error. The key is also interpreted as raw UTF-8 bytes, so a non-ASCII key produces a byte length unrelated to its character length, and a key long enough to look safe can carry far less entropy than 256 bits.

4. **The shipped default is a placeholder.** `docker-compose.yml:18` sets the `ENCRYPTION_KEY` environment variable with a shell default of the literal string `your_encryption_key_here`. A deployment that never sets the variable starts successfully and encrypts every stored secret under a publicly known string. `index.ts:getSecrets` checks only that the three secrets are non-empty; it validates nothing about them.

5. **Call sites fall back to an empty key.** `routes/profiles.ts:10` and `:18`, `utilities/preview-generator.utility.ts:190`, and `workers/feed-updater.worker.ts:112` all default the key to the empty string when the environment variable is absent. In that state, values are encrypted under the empty string with no error.

## Required observable behavior

1. **Protected values are sealed with authenticated encryption.** New values must be written with AES-256-GCM, binding the authentication tag over the ciphertext, the IV, and the version identifier. Any modification to any part of a stored envelope — ciphertext, IV, tag, or version — must cause decryption to fail loudly with an error that identifies it as an integrity failure, never to return altered plaintext. Prove tampering at each of those positions independently.

2. **The envelope is versioned and self-describing.** A stored value must declare its format so the reader can tell a legacy AES-CBC value from a new AES-GCM one without guessing. Do not assert a specific serialization; assert the contract — an envelope written by the new code is recognizable as such, a legacy value is recognizable as legacy, and a value whose version is unknown is refused rather than parsed on a best-effort basis.

3. **Existing values keep working: read-old, write-new.** Values already stored in the legacy AES-CBC format must still decrypt to exactly their original plaintext. This is the compatibility requirement of the slice and is not negotiable: silently losing the ability to read stored secrets would lock operators out of their own proxies and mailboxes. Anything the system rewrites must be written in the new format.

4. **Plaintext round-trips byte for byte.** Encrypting and decrypting must return exactly the input, including leading and trailing whitespace, interior newlines, non-ASCII characters, emoji, and the empty string. Test leading and trailing whitespace explicitly — the current implementation fails it, and that failure must be visible in RED.

5. **A weak, placeholder, or malformed key is refused at startup, in production.** Startup must fail with an actionable message when the encryption key is absent, is the shipped placeholder, is too short to supply 256 bits, or is otherwise unusable. Refusal must be observable as a refusal, not a stack trace from deep inside the cipher. Development ergonomics may differ from production, but the production path must fail closed; state which environment signal governs it and prove both sides.

6. **Bulk migration is available and idempotent.** An operator must be able to migrate every stored protected value from legacy to the new format in one action. Running it twice must not double-encrypt, corrupt, or alter any value. It must report what it changed. A value it cannot decrypt must be reported and left untouched rather than dropped or overwritten — losing an unreadable secret is worse than leaving it.

7. **Key rotation is supported.** Re-encrypting stored values from an old key to a new one must be possible without downtime for values already readable under the old key. A value that cannot be decrypted with the old key must be reported, not silently re-encrypted under the new one. Decryption with the wrong key must fail cleanly and distinguishably from decryption of a corrupted envelope.

8. **`resolveProtectedValues` and `maskProtectedValues` keep their current contracts.** Nested objects and arrays still resolve, `env`-type values still resolve from the environment with prefix and suffix applied, masking still replaces `protected` values with the mask string and leaves `env` values alone, and `preserveMaskedProtectedValues` still restores an existing value when the incoming one is the mask. The 50 existing tests across the three crypto-adjacent suites must continue to pass.

## Anti-bypass and adversarial requirements

- Do not satisfy the integrity requirement by adding a separate unauthenticated checksum. The authentication tag must come from the AEAD construction itself.
- Do not keep `.trim()`, or any other normalization, anywhere on the decrypt path.
- Do not make legacy values readable by leaving the new format optional — new writes must be AES-GCM, and a test must prove a freshly written value is not in the legacy format.
- Do not weaken the startup check to a warning to make a test pass. Requirement 5 is a refusal.
- Do not resolve the empty-key call sites by deleting the feature; either the empty key must be refused or the call sites must be corrected so the key is always present. State which, and test the resulting behaviour.
- The IV must be freshly generated per encryption. Prove that encrypting the same plaintext twice under the same key yields different envelopes — a fixed or counter-derived IV is catastrophic for GCM specifically, since IV reuse leaks the authentication key.
- Do not use a non-cryptographic random source for the IV or for generated keys.
- Do not introduce a new dependency for this. Bun exposes `node:crypto`, which provides AES-256-GCM directly; `node-forge` is already present but is not required on the new path.

## Test-author expectations

- Unit tests over `utilities/security.utility.ts` and `utilities/protected-values.utility.ts` for the envelope, tampering, round-trip fidelity, wrong-key behaviour, and IV uniqueness.
- Tests for the migration and rotation entry points that construct their own fixture store rather than depending on `configs/` having content, since it is empty here.
- A test that pins the legacy format explicitly: construct a value with the *current* AES-CBC code path and prove the new reader still decrypts it to the exact original plaintext. This is the regression that matters most, so make it impossible to pass by accident.
- Startup-validation tests should exercise the validation as a callable unit where possible rather than by spawning the server, but if a process boundary is genuinely required, state why.
- New test files must add ZERO Biome warnings against the locked ceiling of 545 warnings / 13 infos. Three previous slices broke that ceiling; check before reporting.

## Notes and open questions for the lead

Flag rather than guess:

- Whether the empty-key call sites (`routes/profiles.ts`, `utilities/preview-generator.utility.ts`, `workers/feed-updater.worker.ts`) should refuse or should be refactored to receive a validated key. Both are defensible; the choice changes what the tests assert.
- Whether the production signal for requirement 5 is `NODE_ENV=production` — as the auth slice used for its local-trust bypass — or something else.
- Whether migration should be exposed as a CLI entry point, an HTTP route, or a startup step. Note that an HTTP route would need to sit behind the session gate closed in `p2-auth-trust-boundary`.
