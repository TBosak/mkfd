// Integration coverage for slice p2-auth-trust-boundary, requirement 4:
// passkey verification must be timing-safe and compare over a fixed-length
// digest rather than raw strings.
//
// Per the brief, this must be asserted structurally (a constant-time
// primitive over equal-length inputs), not by measuring wall-clock timing,
// which is non-deterministic in CI. This file follows the same
// source-structure-assertion pattern already used elsewhere in this suite
// (e.g. tests/static-diagnostics-cleanup-architecture.test.ts,
// tests/regex-and-callback-correctness-preservation.test.ts).
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const INDEX_TS_PATH = resolve(import.meta.dir, "..", "index.ts");

describe("passkey comparison is structurally constant-time", () => {
  test("index.ts does not compare the submitted passkey to the secret with a raw equality operator", async () => {
    const source = await readFile(INDEX_TS_PATH, "utf8");
    // The exact shipped defect: `inputKey === passkey` at index.ts:163-164
    // short-circuits on the first differing byte.
    expect(source).not.toMatch(/inputKey\s*===?\s*passkey/);
    expect(source).not.toMatch(/passkey\s*===?\s*inputKey/);
  });

  test("index.ts uses a constant-time comparison primitive for passkey verification", async () => {
    const source = await readFile(INDEX_TS_PATH, "utf8");
    expect(source).toMatch(/timingSafeEqual/);
  });

  test("index.ts hashes the passkey inputs to a fixed-length digest before comparing", async () => {
    const source = await readFile(INDEX_TS_PATH, "utf8");
    // A raw string is variable-length; timingSafeEqual on unequal-length
    // buffers throws, so comparing two independently-hashed, fixed-length
    // digests (rather than the raw submitted/stored strings) is required
    // for the constant-time comparison to be meaningful and safe to call
    // unconditionally.
    expect(source).toMatch(/createHash|scryptSync|pbkdf2Sync/);
  });
});
