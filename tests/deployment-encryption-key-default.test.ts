import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

describe("docker-compose.yml no longer ships an encryption-key placeholder default (defect 4)", () => {
  const composeText = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");
  const encryptionKeyLine = composeText.split("\n").find((line) => line.includes("ENCRYPTION_KEY="));

  it("has an ENCRYPTION_KEY line to check (prerequisite)", () => {
    expect(encryptionKeyLine).toBeDefined();
  });

  it("does not contain the known placeholder value 'your_encryption_key_here'", () => {
    expect(composeText).not.toContain("your_encryption_key_here");
  });

  it("does not supply any shell fallback default for ENCRYPTION_KEY, so a deployment that never sets it fails to start rather than silently using a known value", () => {
    // A `${ENCRYPTION_KEY:-...}` default of ANY kind reintroduces a
    // publicly-known encryption key for anyone who forgets to set the
    // variable. Only the absence of a `:-` fallback makes that failure mode
    // impossible at the Compose level; runtime enforcement is covered by
    // assertValidEncryptionKey in startup-encryption-key-validation.test.ts.
    expect(encryptionKeyLine as string).not.toMatch(/ENCRYPTION_KEY:-/);
  });
});
