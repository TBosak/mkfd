import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the Docker dependency-installation contract from the
// `p1-dependency-ci-security-baseline` requirements brief, requirement 8:
// "CI and Docker use frozen lockfiles". Scoped strictly to what the brief
// lists as this slice's Docker surface ("Docker dependency installation
// only") - the root `bun install` step - not a wholesale rewrite of the
// image's build/runtime behavior.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const dockerfileSource = readFileSync(join(REPO_ROOT, "dockerfile"), "utf8");

/** Every top-level `RUN` instruction's script body, one entry per instruction (a `RUN` using `\` line continuations is joined into one entry). */
function runInstructionBodies(dockerfileText: string): string[] {
  const joined = dockerfileText.replace(/\\\r?\n/g, " ");
  const lines = joined.split(/\r?\n/);
  const bodies: string[] = [];
  for (const line of lines) {
    const match = /^\s*RUN\s+(.*)$/.exec(line);
    if (match) bodies.push(match[1]);
  }
  return bodies;
}

function dockerInstallIsFrozen(dockerfileText: string): boolean {
  const bunInstallRuns = runInstructionBodies(dockerfileText).filter((body) => /\bbun\s+install\b/.test(body));
  if (bunInstallRuns.length === 0) return false;
  return bunInstallRuns.every((body) => /--frozen-lockfile\b/.test(body));
}

describe("runInstructionBodies / dockerInstallIsFrozen helper correctness", () => {
  test("extracts a simple RUN instruction body", () => {
    expect(runInstructionBodies("FROM oven/bun:1.2.2\nRUN bun install\n")).toEqual(["bun install"]);
  });

  test("joins a backslash line-continued RUN instruction into one body", () => {
    const text = "RUN bun install \\\n  --frozen-lockfile\n";
    const bodies = runInstructionBodies(text);
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toContain("bun install");
    expect(bodies[0]).toContain("--frozen-lockfile");
  });

  test("flags a bare 'bun install' with no --frozen-lockfile as not frozen", () => {
    expect(dockerInstallIsFrozen("FROM x\nRUN bun install\n")).toBe(false);
  });

  test("accepts a 'bun install --frozen-lockfile' RUN instruction", () => {
    expect(dockerInstallIsFrozen("FROM x\nRUN bun install --frozen-lockfile\n")).toBe(true);
  });

  test("flags it when ANY of multiple bun install RUN instructions omits the flag", () => {
    const text = "FROM x\nRUN bun install --frozen-lockfile\nRUN cd sub && bun install\n";
    expect(dockerInstallIsFrozen(text)).toBe(false);
  });

  test("returns false when there is no 'bun install' RUN instruction at all (nothing to certify as frozen)", () => {
    expect(dockerInstallIsFrozen("FROM x\nRUN echo hi\n")).toBe(false);
  });
});

describe("dockerfile installs dependencies from the frozen lockfile (requirement 8)", () => {
  test("the dockerfile contains at least one 'bun install' RUN instruction", () => {
    expect(runInstructionBodies(dockerfileSource).some((b) => /\bbun\s+install\b/.test(b))).toBe(true);
  });

  test("every 'bun install' RUN instruction in the dockerfile uses --frozen-lockfile", () => {
    expect(dockerInstallIsFrozen(dockerfileSource)).toBe(true);
  });
});

describe("unchanged compatibility surface: lockfile is copied before install runs (regression guard)", () => {
  test("bun.lock is COPYed into the image before the bun install RUN instruction", () => {
    const copyIndex = dockerfileSource.search(/^\s*COPY\s+package\.json\s+bun\.lock\*?\s+/m);
    const installIndex = dockerfileSource.search(/^\s*RUN\s+.*bun\s+install\b/m);
    expect(copyIndex, "expected a COPY of package.json and bun.lock*").toBeGreaterThanOrEqual(0);
    expect(installIndex, "expected a RUN ... bun install instruction").toBeGreaterThanOrEqual(0);
    expect(copyIndex).toBeLessThan(installIndex);
  });
});
