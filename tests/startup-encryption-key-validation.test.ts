import { afterEach, describe, expect, it } from "bun:test";
import { assertValidEncryptionKey } from "../utilities/security.utility";
import { expectDeliberateKeyRefusal } from "./helpers/protected-value-fixtures";

// ---------------------------------------------------------------------------
// Assumed contract for this slice (p2-protected-value-aes-gcm), requirement 5:
//
//   assertValidEncryptionKey(key: string | undefined): void
//
// throws with an actionable message when `key` is unusable, and the
// production/development distinction is governed by `NODE_ENV === "production"`
// — the same signal index.ts already uses for its local-trust dev bypass
// (`devBypassEnabled`). This is a design choice this test author made to
// keep the validation callable as a unit per the brief's own preference
// ("exercise the validation as a callable unit where possible rather than
// by spawning the server"); testing it by spawning `index.ts` would require
// a real TTY-less process boundary, a free port, and a working DB/filesystem
// setup, none of which this validation logic itself needs.
// ---------------------------------------------------------------------------

const PLACEHOLDER = "your_encryption_key_here";
const VALID_KEY = "a18c1fd2211edd76a18c1fd2211edd76"; // 32 bytes = 256 bits

function withNodeEnv<T>(value: string, fn: () => T): T {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
}

afterEach(() => {
  delete process.env.NODE_ENV;
});

describe("assertValidEncryptionKey — production (NODE_ENV=production) fails closed (requirement 5)", () => {
  it("refuses an absent key with a deliberate, actionable error — not a stack trace from deep inside the cipher", () => {
    withNodeEnv("production", () => {
      expectDeliberateKeyRefusal(() => assertValidEncryptionKey(undefined));
    });
  });

  it("refuses an empty-string key with a deliberate, actionable error", () => {
    withNodeEnv("production", () => {
      expectDeliberateKeyRefusal(() => assertValidEncryptionKey(""));
    });
  });

  it("refuses the shipped docker-compose placeholder with a deliberate, actionable error", () => {
    withNodeEnv("production", () => {
      expectDeliberateKeyRefusal(() => assertValidEncryptionKey(PLACEHOLDER));
    });
  });

  it("refuses a key too short to supply 256 bits with a deliberate, actionable error", () => {
    withNodeEnv("production", () => {
      expectDeliberateKeyRefusal(() => assertValidEncryptionKey("short-key"));
    });
  });

  it("accepts a full 256-bit key", () => {
    withNodeEnv("production", () => {
      expect(() => assertValidEncryptionKey(VALID_KEY)).not.toThrow();
    });
  });
});

describe("assertValidEncryptionKey — outside production, ergonomics may differ (requirement 5)", () => {
  it("does not require a full-strength key when NODE_ENV is not 'production'", () => {
    withNodeEnv("development", () => {
      expect(() => assertValidEncryptionKey("short-key")).not.toThrow();
    });
  });

  it("does not require a full-strength key when NODE_ENV is unset", () => {
    expect(process.env.NODE_ENV).toBeUndefined();
    expect(() => assertValidEncryptionKey("short-key")).not.toThrow();
  });
});
