import { expect } from "bun:test";
import forge from "node-forge";
import { isProtectedValue } from "../../utilities/protected-values.utility";

/**
 * Frozen copy of the pre-slice `encrypt()` from
 * `utilities/security.utility.ts` (AES-CBC via node-forge, no MAC). This
 * lets tests construct legacy-format fixtures independently of however
 * `security.utility.ts` changes during the `p2-protected-value-aes-gcm`
 * slice, so the "read-old" compatibility tests keep meaning even after the
 * production cipher is replaced.
 */
export function legacyForgeEncrypt(text: string, encryptionKey: string): string {
  const iv = forge.random.getBytesSync(16);
  const key = forge.util.createBuffer(encryptionKey, "utf8").getBytes(32);

  const cipher = forge.cipher.createCipher("AES-CBC", key);
  cipher.start({ iv });
  cipher.update(forge.util.createBuffer(text, "utf8"));
  cipher.finish();

  return forge.util.encode64(iv + cipher.output.getBytes());
}

/** True only for a string made exclusively of standard base64 characters, i.e. the legacy envelope's shape (no self-describing structure). */
export const BASE64_ONLY = /^[A-Za-z0-9+/]+={0,2}$/;

/** Recursively finds every `{ type: "protected", value }` entry in a parsed config, however deeply nested in objects/arrays. */
export function collectProtectedValues(
  node: unknown,
  path = "$",
): Array<{ path: string; value: string }> {
  if (isProtectedValue(node)) {
    return node.type === "protected" ? [{ path, value: node.value }] : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => collectProtectedValues(item, `${path}[${i}]`));
  }
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      collectProtectedValues(value, `${path}.${key}`),
    );
  }
  return [];
}

/**
 * Matches messages that look like an accidental crash from deep inside a
 * cipher library rather than a deliberate, actionable refusal — e.g. the
 * current `node-forge` path's `"tmp.length is not a function"` when handed
 * an empty or too-short key. A bare `expect(fn).toThrow()` is satisfied by
 * that crash just as readily as by a real refusal, which makes it pass for
 * the wrong reason against today's code. Requirement 5 explicitly demands
 * an actionable message, "not a stack trace from deep inside the cipher".
 */
const INTERNAL_CRASH_SIGNATURE =
  /is not a function|is not defined|cannot read propert|undefined is not|null is not|is not iterable|invalid array length|\bforge\b|node_modules/i;

/**
 * Asserts that `fn` throws a deliberate, actionable, key-related refusal:
 * an `Error` with a non-empty message that (a) does not look like an
 * incidental crash bubbling up from inside a cipher library and (b)
 * actually mentions the key, so a caller reading it understands what was
 * wrong. Use this in place of a bare `expect(fn).toThrow()` for every
 * assertion about a key being refused — an empty/placeholder/too-short key
 * at startup, or an empty key at `encrypt`/`decrypt`/`protectValue`/
 * `resolveProtectedValue` — since node-forge already throws unintelligibly
 * for several of these inputs today, which would otherwise make the test
 * pass before the fix exists.
 */
export function expectDeliberateKeyRefusal(fn: () => unknown): void {
  let threw = false;
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  expect(threw).toBe(true);
  expect(caught).toBeInstanceOf(Error);
  const message = (caught as Error).message;
  expect(message.length).toBeGreaterThan(0);
  expect(message).not.toMatch(INTERNAL_CRASH_SIGNATURE);
  expect(message).toMatch(/key/i);
}
