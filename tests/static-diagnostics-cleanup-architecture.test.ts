import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the "reach zero" contract from the `p1-static-diagnostics-cleanup`
// requirements brief (roadmap Packet 1, C3/H2 follow-through on
// `p1-static-quality-contract`). `tests/static-quality-scripts.test.ts` and
// `tests/static-quality-biome-config.test.ts` already specify the checked-in
// script/config *shape* and explicitly do NOT require the hundreds of
// existing application diagnostics to be clean. This suite closes that gap:
// it runs the real, pinned `bun run lint` / `bun run lint:root` /
// `bun run lint:frontend` / `bun run typecheck` / `bun run typecheck:root` /
// `bun run typecheck:frontend` scripts exactly as a developer or CI job
// would, and asserts they exit zero with zero error-level diagnostics - the
// actual required outcome, not a diagnostic-count snapshot.
//
// At authoring time, the real pinned Biome binary reports:
//   Checked 286 files in ~150ms. Found 92 errors. Found 545 warnings. Found 13 infos.
// on `bunx @biomejs/biome lint . --config-path biome.json`, and
// `bun run typecheck:root` / `:frontend` both fail with real tsc diagnostics.
// These tests are therefore RED until the owning source/config files are
// fixed - never RED for a missing binary, network access, or a harness bug.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");

const LINT_TIMEOUT_MS = 60_000;
const TYPECHECK_TIMEOUT_MS = 120_000;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

// Several independent assertions below need the outcome of the exact same
// real command (e.g. "bun run lint -- --reporter=summary" is the correct
// probe for exit code, error count, file-checked count, warning ceiling, AND
// info ceiling - five independent, individually-attributable test() cases).
// Re-spawning Biome/tsc for each one is real, measurable process-startup
// cost multiplied across the suite for no additional signal, since the
// command and its output are identical every time within a single test run.
// This cache reuses one real spawned result per unique (script, args) pair
// while every test() below still makes and reports its own independent
// assertion against that shared result.
const bunScriptCache = new Map<string, RunResult>();

function runBunScript(scriptName: string, extraArgs: string[] = []): RunResult {
  const cacheKey = JSON.stringify([scriptName, extraArgs]);
  const cached = bunScriptCache.get(cacheKey);
  if (cached) return cached;
  const args = extraArgs.length > 0 ? ["run", scriptName, "--", ...extraArgs] : ["run", scriptName];
  const proc = Bun.spawnSync({ cmd: ["bun", ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const result: RunResult = { exitCode: proc.exitCode ?? 1, stdout, stderr, combined: `${stdout}\n${stderr}` };
  bunScriptCache.set(cacheKey, result);
  return result;
}

interface LintSummary {
  errors: number;
  warnings: number;
  infos: number;
}

/** Parses Biome's `--reporter=summary` "Found N errors/warnings/infos." lines. Missing lines mean 0. */
function parseLintSummary(output: string): LintSummary {
  const errors = Number(output.match(/Found (\d+) errors?\./)?.[1] ?? "0");
  const warnings = Number(output.match(/Found (\d+) warnings?\./)?.[1] ?? "0");
  const infos = Number(output.match(/Found (\d+) infos?\./)?.[1] ?? "0");
  return { errors, warnings, infos };
}

describe("parseLintSummary helper correctness", () => {
  test("parses all three counts when present", () => {
    const sample = "Checked 3 files in 5ms.\nFound 2 errors.\nFound 4 warnings.\nFound 1 info.";
    expect(parseLintSummary(sample)).toEqual({ errors: 2, warnings: 4, infos: 1 });
  });

  test("treats missing lines as zero (a fully clean run prints no Found lines)", () => {
    expect(parseLintSummary("Checked 3 files in 5ms. No fixes applied.")).toEqual({
      errors: 0,
      warnings: 0,
      infos: 0,
    });
  });
});

// --------------------------- requirement 1: root `bun run lint` ---------------------------

describe("root aggregate `bun run lint` exits zero with no error-level diagnostics (requirement 1)", () => {
  test(
    "exit code is 0",
    () => {
      const result = runBunScript("lint", ["--reporter=summary"]);
      expect(result.exitCode, result.combined).toBe(0);
    },
    LINT_TIMEOUT_MS,
  );

  test(
    "reports zero errors across its configured root+frontend scope",
    () => {
      const result = runBunScript("lint", ["--reporter=summary"]);
      const summary = parseLintSummary(result.combined);
      expect(summary.errors, result.combined).toBe(0);
    },
    LINT_TIMEOUT_MS,
  );

  test(
    "at least one file was actually checked (not a no-op/empty scope)",
    () => {
      const result = runBunScript("lint", ["--reporter=summary"]);
      const checkedMatch = result.combined.match(/Checked (\d+) files? in/);
      expect(checkedMatch, result.combined).not.toBeNull();
      expect(Number(checkedMatch?.[1])).toBeGreaterThan(0);
    },
    LINT_TIMEOUT_MS,
  );
});

describe("root and frontend lint halves individually reach zero errors (spec: 'Root and frontend lint ... complete with zero errors')", () => {
  test(
    "'lint:root' exits zero with zero errors",
    () => {
      const result = runBunScript("lint:root", ["--reporter=summary"]);
      expect(result.exitCode, result.combined).toBe(0);
      expect(parseLintSummary(result.combined).errors, result.combined).toBe(0);
    },
    LINT_TIMEOUT_MS,
  );

  test(
    "'lint:frontend' exits zero with zero errors",
    () => {
      const result = runBunScript("lint:frontend", ["--reporter=summary"]);
      expect(result.exitCode, result.combined).toBe(0);
      expect(parseLintSummary(result.combined).errors, result.combined).toBe(0);
    },
    LINT_TIMEOUT_MS,
  );
});

// --------------------------- requirement 2: typecheck entry points ---------------------------

describe("all three typecheck entry points exit zero (requirement 2)", () => {
  test(
    "'typecheck:root' exits zero",
    () => {
      const result = runBunScript("typecheck:root");
      expect(result.exitCode, result.combined).toBe(0);
    },
    TYPECHECK_TIMEOUT_MS,
  );

  test(
    "'typecheck:frontend' exits zero (covers both the app project and the E2E project)",
    () => {
      const result = runBunScript("typecheck:frontend");
      expect(result.exitCode, result.combined).toBe(0);
    },
    TYPECHECK_TIMEOUT_MS,
  );

  test(
    "aggregate 'typecheck' exits zero",
    () => {
      const result = runBunScript("typecheck");
      expect(result.exitCode, result.combined).toBe(0);
    },
    TYPECHECK_TIMEOUT_MS,
  );
});

// --------------------------- requirement 3: CSS/Tailwind parsing ---------------------------

describe("supported Tailwind/CSS syntax parses through the pinned Biome config, without excluding CSS (requirement 3)", () => {
  function localBiomeBinPath(): string | null {
    const dotBin = join(REPO_ROOT, "node_modules", ".bin");
    const candidates =
      process.platform === "win32"
        ? [join(dotBin, "biome.exe"), join(dotBin, "biome.CMD"), join(dotBin, "biome.cmd")]
        : [join(dotBin, "biome")];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  // Same one-real-spawn-per-unique-command cache rationale as `runBunScript`
  // above: all three tests in this block probe the identical
  // `biome lint frontend/src/index.css --config-path biome.json` command.
  const pinnedBiomeCache = new Map<string, RunResult>();

  function runPinnedBiome(args: string[]): RunResult {
    const cacheKey = JSON.stringify(args);
    const cached = pinnedBiomeCache.get(cacheKey);
    if (cached) return cached;
    const bin = localBiomeBinPath();
    expect(bin, "no local node_modules/.bin/biome(.exe) found").not.toBeNull();
    const proc = Bun.spawnSync({ cmd: [bin as string, ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    const result: RunResult = { exitCode: proc.exitCode ?? 1, stdout, stderr, combined: `${stdout}\n${stderr}` };
    pinnedBiomeCache.set(cacheKey, result);
    return result;
  }

  test(
    "frontend/src/index.css is not reported as ignored, and at least one file is checked",
    () => {
      const result = runPinnedBiome(["lint", "frontend/src/index.css", "--config-path", "biome.json"]);
      expect(/provided but ignored/i.test(result.stderr), result.combined).toBe(false);
      const checkedMatch = result.combined.match(/Checked (\d+) files? in/);
      expect(checkedMatch, result.combined).not.toBeNull();
      expect(Number(checkedMatch?.[1])).toBeGreaterThan(0);
    },
    LINT_TIMEOUT_MS,
  );

  test(
    "frontend/src/index.css produces zero parse errors (Tailwind @apply/@tailwind directives are understood)",
    () => {
      const result = runPinnedBiome(["lint", "frontend/src/index.css", "--config-path", "biome.json"]);
      expect(/Tailwind-specific syntax is disabled/i.test(result.combined), result.combined).toBe(false);
      expect(/^reporter\/parse/m.test(result.combined), result.combined).toBe(false);
    },
    LINT_TIMEOUT_MS,
  );

  test(
    "frontend/src/index.css produces zero lint errors (e.g. no lingering noUnknownAtRules on @tailwind)",
    () => {
      const result = runPinnedBiome(["lint", "frontend/src/index.css", "--config-path", "biome.json"]);
      expect(result.exitCode, result.combined).toBe(0);
    },
    LINT_TIMEOUT_MS,
  );
});

// --------------------------- non-goal ceiling: warnings/infos never regress ---------------------------

describe("warning/info diagnostics never exceed the pre-fix baseline (spec non-goal: no new warning-only debt)", () => {
  // Authoring-time baseline from the real pinned binary: 545 warnings, 13
  // infos, across 286 checked files. This slice targets zero *errors*; it
  // explicitly does not require the pre-existing warning-only diagnostics
  // (scheduled for later-packet rewrites) to be cleaned up, but a
  // conforming fix must not silently trade errors for *more* warnings
  // (e.g. widening `noExplicitAny`/`noNonNullAssertion` usage, or
  // downgrading an error-level rule to "warn" in config).
  const WARNING_BASELINE = 545;
  const INFO_BASELINE = 13;

  test(
    "aggregate lint warnings do not exceed the pre-fix baseline",
    () => {
      const result = runBunScript("lint", ["--reporter=summary"]);
      const summary = parseLintSummary(result.combined);
      expect(summary.warnings, result.combined).toBeLessThanOrEqual(WARNING_BASELINE);
    },
    LINT_TIMEOUT_MS,
  );

  test(
    "aggregate lint infos do not exceed the pre-fix baseline",
    () => {
      const result = runBunScript("lint", ["--reporter=summary"]);
      const summary = parseLintSummary(result.combined);
      expect(summary.infos, result.combined).toBeLessThanOrEqual(INFO_BASELINE);
    },
    LINT_TIMEOUT_MS,
  );
});
