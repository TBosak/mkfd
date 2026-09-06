import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { decrypt, encrypt } from "../utilities/security.utility";
import { rotateProtectedValueStore } from "../utilities/protected-value-migration.utility";
import { collectProtectedValues, legacyForgeEncrypt } from "./helpers/protected-value-fixtures";

// ---------------------------------------------------------------------------
// Assumed contract for this slice (p2-protected-value-aes-gcm), requirement 7,
// sharing the migration entry point's module and its real YAML store format
// (see protected-value-migration.test.ts):
//
//   interface RotationReport {
//     scannedFiles: string[];
//     rotatedFiles: string[];
//     rotatedValues: number;
//     unreadable: Array<{ file: string; path: string; error: string }>;
//   }
//   function rotateProtectedValueStore(configsDir: string, oldKey: string, newKey: string): Promise<RotationReport>;
// ---------------------------------------------------------------------------

const OLD_KEY = "a18c1fd2211edd76a18c1fd2211edd76";
const NEW_KEY = "f00dfeedface1337f00dfeedface1337";
const FOREIGN_KEY = "deadbeefdeadbeefdeadbeefdeadbeef";

let workDir = "";

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = "";
});

async function makeStore(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), "mkfd-protected-value-rotation-"));
  return workDir;
}

async function writeYamlConfig(dir: string, id: string, config: Record<string, unknown>): Promise<string> {
  const path = join(dir, `${id}.yaml`);
  await writeFile(path, yaml.dump(config), "utf8");
  return path;
}

async function readYamlConfig(path: string): Promise<Record<string, unknown>> {
  return yaml.load(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("rotateProtectedValueStore — key rotation without downtime, over the real YAML store (requirement 7)", () => {
  it("re-encrypts a legacy-format value in a real-shaped .yaml feed config under the new key, preserving plaintext", async () => {
    const dir = await makeStore();
    const path = await writeYamlConfig(dir, "feed", {
      feedId: "feed",
      feedType: "rest",
      config: {
        headers: { Authorization: { type: "protected", value: legacyForgeEncrypt("rotated-secret", OLD_KEY) } },
      },
    });

    const report = await rotateProtectedValueStore(dir, OLD_KEY, NEW_KEY);

    expect(report.rotatedValues).toBe(1);
    const values = collectProtectedValues(await readYamlConfig(path));
    expect(decrypt(values[0].value, NEW_KEY)).toBe("rotated-secret");
    expect(() => decrypt(values[0].value, OLD_KEY)).toThrow();
  });

  it("re-encrypts a value already in the new AES-GCM format under the new key too", async () => {
    const dir = await makeStore();
    const path = await writeYamlConfig(dir, "feed", {
      auth: { type: "protected", value: encrypt("already-modern-secret", OLD_KEY) },
    });

    const report = await rotateProtectedValueStore(dir, OLD_KEY, NEW_KEY);

    expect(report.rotatedValues).toBe(1);
    const values = collectProtectedValues(await readYamlConfig(path));
    expect(decrypt(values[0].value, NEW_KEY)).toBe("already-modern-secret");
  });

  it("reports, and leaves the file byte-for-byte untouched, a value that cannot be decrypted with the old key — never silently re-encrypting it under the new key", async () => {
    const dir = await makeStore();
    const foreignCiphertext = legacyForgeEncrypt("not-yours", FOREIGN_KEY);
    const path = await writeYamlConfig(dir, "feed", { auth: { type: "protected", value: foreignCiphertext } });
    const before = await readFile(path, "utf8");

    const report = await rotateProtectedValueStore(dir, OLD_KEY, NEW_KEY);

    expect(report.rotatedValues).toBe(0);
    expect(report.unreadable).toHaveLength(1);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("rotates values readable under the old key even when a sibling file is unreadable (no downtime for the readable values)", async () => {
    const dir = await makeStore();
    const goodPath = await writeYamlConfig(dir, "good", {
      auth: { type: "protected", value: legacyForgeEncrypt("good-secret", OLD_KEY) },
    });
    await writeYamlConfig(dir, "bad", {
      auth: { type: "protected", value: legacyForgeEncrypt("foreign-secret", FOREIGN_KEY) },
    });

    const report = await rotateProtectedValueStore(dir, OLD_KEY, NEW_KEY);

    expect(report.rotatedValues).toBe(1);
    expect(report.unreadable).toHaveLength(1);
    const goodValues = collectProtectedValues(await readYamlConfig(goodPath));
    expect(decrypt(goodValues[0].value, NEW_KEY)).toBe("good-secret");
  });

  it("is idempotent: rotating an already-rotated store a second time with the same key pair rotates nothing further and does not corrupt values", async () => {
    const dir = await makeStore();
    const path = await writeYamlConfig(dir, "feed", {
      auth: { type: "protected", value: legacyForgeEncrypt("idempotent-rotation", OLD_KEY) },
    });

    await rotateProtectedValueStore(dir, OLD_KEY, NEW_KEY);
    const afterFirst = await readFile(path, "utf8");

    const second = await rotateProtectedValueStore(dir, OLD_KEY, NEW_KEY);

    expect(second.rotatedValues).toBe(0);
    const afterSecond = await readFile(path, "utf8");
    expect(afterSecond).toBe(afterFirst);

    const values = collectProtectedValues(await readYamlConfig(path));
    expect(decrypt(values[0].value, NEW_KEY)).toBe("idempotent-rotation");
  });

  it("decrypting a wrong-key value and decrypting a corrupted envelope fail distinguishably (requirement 7)", () => {
    const validUnderNewKey = encrypt("secret", NEW_KEY);
    let wrongKeyMessage = "";
    try {
      decrypt(validUnderNewKey, OLD_KEY);
    } catch (err) {
      wrongKeyMessage = (err as Error).message;
    }

    let corruptedMessage = "";
    try {
      decrypt("@@@ not an envelope, not legacy base64 @@@", NEW_KEY);
    } catch (err) {
      corruptedMessage = (err as Error).message;
    }

    expect(wrongKeyMessage.length).toBeGreaterThan(0);
    expect(corruptedMessage.length).toBeGreaterThan(0);
    expect(wrongKeyMessage).not.toBe(corruptedMessage);
  });
});
