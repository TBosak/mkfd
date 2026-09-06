import { describe, expect, it } from "bun:test";
import { decrypt, encrypt } from "../utilities/security.utility";
import {
  BASE64_ONLY,
  expectDeliberateKeyRefusal,
  legacyForgeEncrypt,
} from "./helpers/protected-value-fixtures";

// ---------------------------------------------------------------------------
// Assumed envelope contract for this slice (p2-protected-value-aes-gcm):
//
//   encrypt() returns a JSON string of the shape
//     { v: <number>, iv: <base64>, tag: <base64>, ct: <base64> }
//
// This is a real, if minimal, design choice on this test author's part —
// the brief for requirement 2 explicitly says "do not assert a specific
// serialization; assert the contract". Most of the tests below only assert
// the *behavioral* contract (self-describing vs. legacy-shaped, tamper at
// each of the four described positions is refused, unknown versions are
// refused). But proving "tamper the IV independently of the tag" requires
// *some* concrete, addressable structure to mutate one field without
// touching the others, and JSON with named fields is the natural way to
// build authenticated encryption with `node:crypto`'s AES-256-GCM (which
// hands back iv/authTag/ciphertext as separate values). If the lead
// implements a different concrete shape, only `parseEnvelope` below needs
// to change to match it — the assertions themselves stay meaningful.
// ---------------------------------------------------------------------------

interface ParsedEnvelope {
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

function parseEnvelope(envelope: string): ParsedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error(
      "encrypt() output is not JSON. This test suite assumes a " +
        "self-describing { v, iv, tag, ct } JSON envelope for new-format " +
        "values (see the comment above parseEnvelope in this file) — " +
        "update parseEnvelope to match the real envelope shape if the " +
        "implementation differs.",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as ParsedEnvelope).v !== "number" ||
    typeof (parsed as ParsedEnvelope).iv !== "string" ||
    typeof (parsed as ParsedEnvelope).tag !== "string" ||
    typeof (parsed as ParsedEnvelope).ct !== "string"
  ) {
    throw new Error(
      "encrypt() output does not have the assumed { v, iv, tag, ct } shape — " +
        "update parseEnvelope in this test file to match the real envelope.",
    );
  }
  return parsed as ParsedEnvelope;
}

function flipLastByte(base64Field: string): string {
  const buf = Buffer.from(base64Field, "base64");
  if (buf.length === 0) throw new Error("cannot tamper an empty field");
  buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
  return buf.toString("base64");
}

function tamperedEnvelope(
  plaintext: string,
  key: string,
  mutate: (parsed: ParsedEnvelope) => ParsedEnvelope,
): string {
  const parsed = parseEnvelope(encrypt(plaintext, key));
  return JSON.stringify(mutate({ ...parsed }));
}

const KEY = "a18c1fd2211edd76a18c1fd2211edd76"; // 32 ASCII chars = 32 bytes = 256 bits
const OTHER_KEY = "f00dfeedface1337f00dfeedface1337"; // different 32-byte key

describe("encrypt/decrypt round-trip fidelity (requirement 4)", () => {
  const cases: Array<[string, string]> = [
    ["plain secret", "plain secret"],
    ["leading and trailing whitespace", "  leading and trailing whitespace  "],
    ["only whitespace", "   "],
    ["interior newlines and tabs", "line one\nline two\r\n\tindented"],
    ["non-ascii and emoji", "emoji 🔐🔑 café — 日本語 — ключ"],
    ["empty string", ""],
  ];

  for (const [label, plaintext] of cases) {
    it(`round-trips exactly (${label}): ${JSON.stringify(plaintext)}`, () => {
      const envelope = encrypt(plaintext, KEY);
      expect(decrypt(envelope, KEY)).toBe(plaintext);
    });
  }

  it("does not trim or otherwise normalize the decrypted plaintext (the '.trim()' defect must not survive)", () => {
    const withPadding = " \t secret with padding on both sides \t ";
    const envelope = encrypt(withPadding, KEY);
    const result = decrypt(envelope, KEY);
    expect(result).toBe(withPadding);
    expect(result.length).toBe(withPadding.length);
  });
});

describe("IV uniqueness (anti-bypass: IV must be freshly generated per encryption)", () => {
  it("encrypting the same plaintext under the same key twice yields two different envelopes", () => {
    const a = encrypt("same secret", KEY);
    const b = encrypt("same secret", KEY);
    expect(a).not.toBe(b);
    expect(decrypt(a, KEY)).toBe("same secret");
    expect(decrypt(b, KEY)).toBe("same secret");
  });

  it("the IV field itself differs across encryptions of the same plaintext", () => {
    const a = parseEnvelope(encrypt("same secret", KEY));
    const b = parseEnvelope(encrypt("same secret", KEY));
    expect(a.iv).not.toBe(b.iv);
  });
});

describe("new writes are AES-GCM, not the legacy AES-CBC shape (anti-bypass: new format is not optional)", () => {
  it("a legacy AES-CBC fixture is plain, undecorated base64 (sanity check on the fixture builder itself)", () => {
    expect(BASE64_ONLY.test(legacyForgeEncrypt("secret", KEY))).toBe(true);
  });

  it("a freshly written value is not shaped like the legacy AES-CBC envelope", () => {
    const fresh = encrypt("secret", KEY);
    expect(BASE64_ONLY.test(fresh)).toBe(false);
  });

  it("a freshly written value declares a version field distinguishing it from a legacy value (requirement 2: self-describing envelope)", () => {
    const fresh = parseEnvelope(encrypt("secret", KEY));
    expect(fresh.v).toBeDefined();
  });
});

describe("legacy AES-CBC compatibility: read-old, write-new (requirement 3 — not negotiable)", () => {
  it("decrypts a value written by the legacy AES-CBC path to the exact original plaintext", () => {
    const legacy = legacyForgeEncrypt("legacy-password", KEY);
    expect(decrypt(legacy, KEY)).toBe("legacy-password");
  });

  it("preserves leading/trailing whitespace when reading a legacy value (the trim() bug must not survive for legacy reads either)", () => {
    const legacy = legacyForgeEncrypt("  spaced legacy secret  ", KEY);
    expect(decrypt(legacy, KEY)).toBe("  spaced legacy secret  ");
  });

  it("decrypts a legacy value containing non-ascii and emoji content", () => {
    const legacy = legacyForgeEncrypt("légàcy 🔒 sëcret", KEY);
    expect(decrypt(legacy, KEY)).toBe("légàcy 🔒 sëcret");
  });

  it("decrypts a legacy empty-string value", () => {
    const legacy = legacyForgeEncrypt("", KEY);
    expect(decrypt(legacy, KEY)).toBe("");
  });
});

describe("authenticated encryption: tampering with any envelope field is refused, never silently decrypted (requirement 1)", () => {
  const secret = "correct horse battery staple";

  it("rejects a bit-flipped IV", () => {
    const tampered = tamperedEnvelope(secret, KEY, (e) => ({ ...e, iv: flipLastByte(e.iv) }));
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("rejects a bit-flipped ciphertext", () => {
    const tampered = tamperedEnvelope(secret, KEY, (e) => ({ ...e, ct: flipLastByte(e.ct) }));
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("rejects a bit-flipped authentication tag", () => {
    const tampered = tamperedEnvelope(secret, KEY, (e) => ({ ...e, tag: flipLastByte(e.tag) }));
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("rejects an envelope whose version identifier has been changed to something unrecognized (requirement 2: unknown version is refused, not best-effort parsed)", () => {
    const tampered = tamperedEnvelope(secret, KEY, (e) => ({ ...e, v: 999999 }));
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("never returns the correct plaintext, nor any string at all, from a ciphertext-tampered envelope (guards against a padding-oracle-style silent-wrong-plaintext failure mode)", () => {
    const tampered = tamperedEnvelope(secret, KEY, (e) => ({ ...e, ct: flipLastByte(e.ct) }));
    let result: string | undefined;
    let threw = false;
    try {
      result = decrypt(tampered, KEY);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(result).toBeUndefined();
  });

  it("rejects a completely malformed, non-envelope string outright", () => {
    expect(() => decrypt("@@@ not an envelope, not legacy base64 @@@", KEY)).toThrow();
  });
});

describe("wrong key vs. corrupted envelope are distinguishable failure modes (requirement 7)", () => {
  it(
    "never returns a value when decrypting a well-formed, untampered envelope with the wrong key, across repeated trials " +
      "(the current AES-CBC path fails only nondeterministically here: an independent 400-trial measurement found the " +
      "wrong key returned an empty-string plaintext instead of throwing 70 times — 17.5% — because decodeUtf8 of " +
      "garbage bytes followed by .trim() collapses to \"\". A caller would then authenticate to a third-party service " +
      "with an empty password and no error anywhere. AES-256-GCM's authentication tag makes this deterministic, so " +
      "this loop must pass 0/N times before the fix and N/N times after it.)",
    () => {
      const trials = 50;
      for (let i = 0; i < trials; i++) {
        const envelope = encrypt("secret", KEY);
        let returned: string | undefined;
        let threw = false;
        try {
          returned = decrypt(envelope, OTHER_KEY);
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
        expect(returned).toBeUndefined();
      }
    },
  );

  it(
    "a wrong-key failure and a malformed-envelope failure are distinguishable, across repeated trials " +
      "(a single sampled attempt is unstable against today's AES-CBC path for the same underlying reason as the " +
      "sibling test above: whether the wrong-key attempt throws at all, and which of two different internal " +
      "node-forge error messages it throws when it does, both vary by draw — sometimes coinciding with the " +
      "malformed-envelope message, sometimes not, and sometimes not throwing at all. Looping makes the RED reason " +
      "— 'wrong-key decryption does not reliably fail, distinguishably from a malformed envelope' — stable rather " +
      "than depending on which combination a single run happens to draw.)",
    () => {
      const trials = 50;
      for (let i = 0; i < trials; i++) {
        const envelope = encrypt("secret", KEY);

        let wrongKeyThrew = false;
        let wrongKeyMessage = "";
        try {
          decrypt(envelope, OTHER_KEY);
        } catch (err) {
          wrongKeyThrew = true;
          wrongKeyMessage = (err as Error).message;
        }

        let malformedThrew = false;
        let malformedMessage = "";
        try {
          decrypt("@@@ not an envelope, not legacy base64 @@@", KEY);
        } catch (err) {
          malformedThrew = true;
          malformedMessage = (err as Error).message;
        }

        expect(wrongKeyThrew).toBe(true);
        expect(malformedThrew).toBe(true);
        expect(wrongKeyMessage.length).toBeGreaterThan(0);
        expect(malformedMessage.length).toBeGreaterThan(0);
        expect(wrongKeyMessage).not.toBe(malformedMessage);
      }
    },
  );
});

describe("key material derivation does not truncate or misinterpret the key (defect 3, corrected: a short/malformed key does not fail silently, but throws late and unintelligibly from inside node-forge instead of a proper KDF simply using the whole key)", () => {
  it("uses the full key string, not a fixed-length raw-byte prefix: two keys sharing a 40-byte prefix but differing afterward must not be interchangeable", () => {
    const keyA = `${"x".repeat(40)}A`;
    const keyB = `${"x".repeat(40)}B`;
    const envelope = encrypt("prefix-collision-check", keyA);
    expect(() => decrypt(envelope, keyB)).toThrow();
  });

  it("round-trips correctly with a non-ascii, multi-byte-per-character key", () => {
    const nonAsciiKey = "clé-sécurisée-🔑-ключ-鍵-opensésame";
    const envelope = encrypt("multi-byte key material", nonAsciiKey);
    expect(decrypt(envelope, nonAsciiKey)).toBe("multi-byte key material");
  });
});

describe("an empty encryption key gets a deliberate, actionable refusal (defect 5, corrected: routes/profiles.ts, preview-generator.utility.ts, and feed-updater.worker.ts's `?? \"\"` call sites do not silently succeed today — they already throw, just unintelligibly, from inside node-forge, rather than failing closed with a clear message)", () => {
  it("encrypt() refuses an empty-string key with an identifiable error, not an incidental node-forge crash", () => {
    expectDeliberateKeyRefusal(() => encrypt("secret", ""));
  });

  it("decrypt() refuses an empty-string key with an identifiable error, even against an otherwise valid envelope", () => {
    const envelope = encrypt("secret", KEY);
    expectDeliberateKeyRefusal(() => decrypt(envelope, ""));
  });
});
