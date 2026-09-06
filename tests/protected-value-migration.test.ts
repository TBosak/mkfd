import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { decrypt } from "../utilities/security.utility";
import { migrateProtectedValueStore } from "../utilities/protected-value-migration.utility";
import { BASE64_ONLY, collectProtectedValues, legacyForgeEncrypt } from "./helpers/protected-value-fixtures";

// ---------------------------------------------------------------------------
// Assumed contract for this slice (p2-protected-value-aes-gcm), requirement 6.
// "Whatever migration entry point the implementation introduces" is this
// slice's to design; this test author's proposal (ratified by the lead,
// with the fixture store corrected to match the real config format) is a
// single exported function operating over the directory of `*.yaml` config
// files `utilities/config-manager.utility.ts` already reads/writes
// (`readFeedConfig`/`writeFeedConfig`, `yaml.load`/`yaml.dump`), invoked by
// a CLI entry point — not a startup step, not an HTTP route in this slice:
//
//   interface MigrationReport {
//     scannedFiles: string[];
//     migratedFiles: string[];
//     migratedValues: number;
//     unreadable: Array<{ file: string; path: string; error: string }>;
//   }
//   function migrateProtectedValueStore(configsDir: string, encryptionKey: string): Promise<MigrationReport>;
// ---------------------------------------------------------------------------

const KEY = "a18c1fd2211edd76a18c1fd2211edd76";

let workDir = "";

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = "";
});

async function makeStore(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), "mkfd-protected-value-migration-"));
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

describe("migrateProtectedValueStore — bulk legacy-to-AES-GCM migration over the real YAML store (requirement 6)", () => {
  it("rewrites every legacy protected value it finds in a real-shaped feed config, at every nesting depth, to the new format, preserving plaintext", async () => {
    const dir = await makeStore();
    const feedA = {
      feedId: "feed-a",
      feedName: "Feed A",
      feedType: "rest",
      config: {
        baseUrl: "https://example.com",
        route: "/items",
        headers: {
          Authorization: { type: "protected", value: legacyForgeEncrypt("top-level-secret", KEY) },
        },
        request: {
          proxyOverride: {
            auth: { password: { type: "protected", value: legacyForgeEncrypt("nested-secret", KEY) } },
          },
        },
        cookies: [{ type: "protected", value: legacyForgeEncrypt("array-secret", KEY) }, "plain"],
      },
    };
    const path = await writeYamlConfig(dir, "feed-a", feedA);

    const report = await migrateProtectedValueStore(dir, KEY);

    expect(report.migratedValues).toBe(3);
    expect(report.migratedFiles).toContain(path);

    const rewritten = await readYamlConfig(path);
    const values = collectProtectedValues(rewritten);
    expect(values).toHaveLength(3);
    for (const { value } of values) {
      expect(BASE64_ONLY.test(value)).toBe(false);
    }

    const byPath = Object.fromEntries(values.map((v) => [v.path, v.value]));
    expect(decrypt(byPath["$.config.headers.Authorization"], KEY)).toBe("top-level-secret");
    expect(decrypt(byPath["$.config.request.proxyOverride.auth.password"], KEY)).toBe("nested-secret");
    expect(decrypt(byPath["$.config.cookies[0]"], KEY)).toBe("array-secret");
  });

  it("migrates a real-shaped .yaml feed config file specifically (not merely a JSON-parseable one)", async () => {
    const dir = await makeStore();
    const path = await writeYamlConfig(dir, "real-feed", {
      feedId: "real-feed",
      feedName: "Real Feed",
      feedType: "webScraping",
      config: {
        baseUrl: "https://example.com",
        auth: { type: "protected", value: legacyForgeEncrypt("yaml-shaped-secret", KEY) },
      },
    });

    const rawBefore = await readFile(path, "utf8");
    expect(() => JSON.parse(rawBefore)).toThrow(); // sanity check: this is genuine YAML, not incidentally valid JSON

    const report = await migrateProtectedValueStore(dir, KEY);

    expect(report.migratedFiles).toContain(path);
    expect(report.migratedValues).toBe(1);
    const values = collectProtectedValues(await readYamlConfig(path));
    expect(decrypt(values[0].value, KEY)).toBe("yaml-shaped-secret");
  });

  it("is idempotent: running migration twice does not double-encrypt or alter a value already in the new format", async () => {
    const dir = await makeStore();
    const path = await writeYamlConfig(dir, "feed", {
      auth: { type: "protected", value: legacyForgeEncrypt("idempotent-secret", KEY) },
    });

    const first = await migrateProtectedValueStore(dir, KEY);
    expect(first.migratedValues).toBe(1);
    const afterFirst = await readFile(path, "utf8");

    const second = await migrateProtectedValueStore(dir, KEY);
    expect(second.migratedValues).toBe(0);
    const afterSecond = await readFile(path, "utf8");

    expect(afterSecond).toBe(afterFirst);
    const values = collectProtectedValues(await readYamlConfig(path));
    expect(decrypt(values[0].value, KEY)).toBe("idempotent-secret");
  });

  it("reports a value it cannot decrypt and leaves the file byte-for-byte untouched, rather than dropping or overwriting it", async () => {
    const dir = await makeStore();
    const path = await writeYamlConfig(dir, "corrupted", {
      auth: { type: "protected", value: "not-a-real-ciphertext-@@@" },
    });
    const before = await readFile(path, "utf8");

    const report = await migrateProtectedValueStore(dir, KEY);

    expect(report.migratedValues).toBe(0);
    expect(report.unreadable).toHaveLength(1);
    expect(report.unreadable[0].file).toBe(path);
    expect(report.unreadable[0].error.length).toBeGreaterThan(0);

    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("leaves plain (non-protected) config values untouched", async () => {
    const dir = await makeStore();
    const path = await writeYamlConfig(dir, "plain", { feedId: "plain-feed", baseUrl: "https://example.com", count: 3 });
    const before = await readFile(path, "utf8");

    const report = await migrateProtectedValueStore(dir, KEY);

    expect(report.migratedValues).toBe(0);
    expect(report.unreadable).toHaveLength(0);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("ignores a genuinely non-config file in the store (e.g. a README), not merely files of the 'wrong' extension", async () => {
    const dir = await makeStore();
    await writeFile(join(dir, "README.txt"), "not a config file", "utf8");

    const report = await migrateProtectedValueStore(dir, KEY);

    expect(report.migratedValues).toBe(0);
    expect(report.unreadable).toHaveLength(0);
  });

  it("a later run picks up newly added files without disturbing files already migrated (restart resilience)", async () => {
    const dir = await makeStore();
    const pathA = await writeYamlConfig(dir, "a", {
      auth: { type: "protected", value: legacyForgeEncrypt("secret-a", KEY) },
    });

    const first = await migrateProtectedValueStore(dir, KEY);
    expect(first.migratedValues).toBe(1);
    const aAfterFirst = await readFile(pathA, "utf8");

    const pathB = await writeYamlConfig(dir, "b", {
      auth: { type: "protected", value: legacyForgeEncrypt("secret-b", KEY) },
    });

    const second = await migrateProtectedValueStore(dir, KEY);
    expect(second.migratedValues).toBe(1);
    expect(await readFile(pathA, "utf8")).toBe(aAfterFirst);

    const bValues = collectProtectedValues(await readYamlConfig(pathB));
    expect(decrypt(bValues[0].value, KEY)).toBe("secret-b");
  });
});
