import { describe, expect, it } from "bun:test";
import { protectValue, resolveProtectedValue } from "../utilities/protected-values.utility";
import { expectDeliberateKeyRefusal } from "./helpers/protected-value-fixtures";

// Exercises the boundary actually reached by routes/profiles.ts,
// utilities/preview-generator.utility.ts, and workers/feed-updater.worker.ts,
// which today do `process.env.ENCRYPTION_KEY ?? ""` (defect 5). Corrected
// characterization: that empty key is not silently accepted today — it
// already throws, just unintelligibly, from inside node-forge (observed:
// `"tmp.length is not a function"` for both an empty and a four-character
// key), rather than failing closed with a message an operator could act on.
// This slice's chosen fix is to refuse the empty key deliberately at the
// crypto layer (see security-utility-aes-gcm.test.ts) rather than to change
// those call sites: they already wrap their encryption/decryption calls in
// an outer try/catch, so a thrown error there fails the request/feed-update
// cleanly instead of crashing the process.

const KEY = "a18c1fd2211edd76a18c1fd2211edd76";

describe("protectValue refuses an empty encryption key", () => {
  it("throws a deliberate, actionable error rather than an incidental node-forge crash", () => {
    expectDeliberateKeyRefusal(() => protectValue("secret", ""));
  });
});

describe("resolveProtectedValue refuses an empty encryption key", () => {
  it("throws a deliberate, actionable error rather than an incidental node-forge crash", () => {
    const pv = protectValue("secret", KEY);
    expectDeliberateKeyRefusal(() => resolveProtectedValue(pv, ""));
  });

  it("still resolves an env-type value even when no encryption key is available (env values never touch the cipher)", () => {
    process.env.TEST_KEY_BOUNDARY_TOKEN = "token-value";
    expect(
      resolveProtectedValue({ type: "env", value: "TEST_KEY_BOUNDARY_TOKEN" }, ""),
    ).toBe("token-value");
    delete process.env.TEST_KEY_BOUNDARY_TOKEN;
  });
});
