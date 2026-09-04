import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Specifies the checked-in Biome configuration contract from the
// `p1-static-quality-contract` requirements brief (roadmap Packet 1, C3).
//
// The inclusion/exclusion assertions below deliberately do NOT reimplement
// Biome's own glob/negation semantics: a hand-written approximation can
// silently disagree with the real tool's traversal/negation rules. Instead
// they resolve the LOCAL pinned biome binary (node_modules/.bin/biome,
// never a network-downloaded `@latest`) and run it for real against
// representative paths, reading its own "Checked N files" / "provided but
// ignored" output - the single source of truth for what the pinned version
// actually does with this exact config.
//
// The VCS-ignore-layer assertions (node_modules, .tdd-state, etc.) use
// `git check-ignore` - a local, offline, authoritative oracle for the same
// .gitignore files Biome's own `vcs.useIgnoreFile` reads - as an
// independent cross-check that does not depend on Biome being installed.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const EXEC_TIMEOUT_MS = 30_000;

interface BiomeConfigShape {
  $schema?: string;
  vcs?: { enabled?: boolean; clientKind?: string; useIgnoreFile?: boolean };
  files?: { includes?: string[]; ignoreUnknown?: boolean; ignore?: string[] };
  linter?: { enabled?: boolean; rules?: Record<string, unknown>; ignore?: string[] };
  organizeImports?: unknown;
}

function readBiomeConfig(): BiomeConfigShape {
  return JSON.parse(readFileSync(join(REPO_ROOT, "biome.json"), "utf8")) as BiomeConfigShape;
}

// --------------------------- real pinned-binary oracle ---------------------------

function localBiomeBinPath(): string | null {
  const dotBin = join(REPO_ROOT, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? [join(dotBin, "biome.exe"), join(dotBin, "biome.CMD"), join(dotBin, "biome.cmd")]
      : [join(dotBin, "biome")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function requireLocalBiomeBin(): string {
  const bin = localBiomeBinPath();
  expect(
    bin,
    "no local node_modules/.bin/biome(.exe) found - pin @biomejs/biome as a root devDependency and run `bun install`",
  ).not.toBeNull();
  if (!bin) throw new Error("unreachable: expect above throws when bin is null");
  return bin;
}

function runPinnedBiome(args: string[]) {
  const bin = requireLocalBiomeBin();
  const proc = Bun.spawnSync({ cmd: [bin, ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    combined: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
  };
}

/** True if the pinned binary reports this path argument as ignored by config (not processed at all). */
function isPathIgnoredByPinnedBiome(pathArg: string): boolean {
  const { stderr } = runPinnedBiome(["lint", pathArg]);
  return /provided but ignored/i.test(stderr);
}

/** The "Checked N files" count the pinned binary reports for this path argument (0 if ignored/empty). */
function checkedFileCount(pathArg: string): number {
  const { stdout } = runPinnedBiome(["lint", pathArg]);
  const match = stdout.match(/Checked (\d+) files? in/);
  return match ? Number(match[1]) : 0;
}

describe("local pinned Biome binary is installed (prerequisite)", () => {
  test("node_modules/.bin/biome(.exe) exists", () => {
    requireLocalBiomeBin();
  });
});

describe("real pinned Biome binary treats frontend source/config/E2E as included (requirement 4)", () => {
  const frontendPaths = ["frontend/src", "frontend/e2e", "frontend/playwright.config.ts", "frontend/vite.config.ts"];

  for (const p of frontendPaths) {
    test(
      `'${p}' is NOT reported as ignored by the pinned binary and has files actually checked`,
      () => {
        expect(isPathIgnoredByPinnedBiome(p), `biome lint ${p}`).toBe(false);
        expect(checkedFileCount(p), `biome lint ${p}`).toBeGreaterThan(0);
      },
      EXEC_TIMEOUT_MS,
    );
  }

  test(
    "root application source remains included (no regression while adding frontend)",
    () => {
      expect(isPathIgnoredByPinnedBiome("index.ts")).toBe(false);
      expect(checkedFileCount("index.ts")).toBeGreaterThan(0);
    },
    EXEC_TIMEOUT_MS,
  );
});

describe("real pinned Biome binary still ignores generated/dependency/runtime artifacts (requirement 4)", () => {
  const mustStayIgnored = [
    "node_modules",
    "frontend/node_modules",
    "public/feeds",
    "frontend/playwright-report",
    "frontend/test-results",
    ".tdd-state",
  ];

  for (const p of mustStayIgnored) {
    test(
      `'${p}' is still reported as ignored by the pinned binary (0 files checked)`,
      () => {
        expect(isPathIgnoredByPinnedBiome(p), `biome lint ${p}`).toBe(true);
        expect(checkedFileCount(p), `biome lint ${p}`).toBe(0);
      },
      EXEC_TIMEOUT_MS,
    );
  }
});

describe("checked-in biome.json still excludes generated/dependency/runtime artifacts via VCS ignore (requirement 4)", () => {
  const config = readBiomeConfig();

  test("vcs.useIgnoreFile remains enabled so gitignored artifacts stay excluded", () => {
    expect(config.vcs?.enabled).toBe(true);
    expect(config.vcs?.useIgnoreFile).toBe(true);
  });

  // Independent, offline, authoritative oracle for "is this path covered by
  // a .gitignore Biome's vcs.useIgnoreFile integration would read" - does
  // not depend on Biome being installed at all.
  function isGitIgnored(relPath: string): boolean {
    const result = spawnSync("git", ["check-ignore", "-q", relPath], { cwd: REPO_ROOT, stdio: "ignore" });
    return result.status === 0;
  }

  const mustStayGitIgnored = [
    "node_modules/some-pkg/index.js",
    "frontend/node_modules/some-pkg/index.js",
    "public/feeds/some-feed.xml",
    "frontend/playwright-report/index.html",
    "frontend/test-results/some-test/trace.zip",
    ".tdd-state/some-slice.json",
  ];

  for (const relPath of mustStayGitIgnored) {
    test(`'${relPath}' is covered by a .gitignore Biome's useIgnoreFile integration reads`, () => {
      expect(isGitIgnored(relPath)).toBe(true);
    });
  }
});

describe("biome.json schema/version and non-deprecated configuration (requirement 5)", () => {
  const config = readBiomeConfig();
  const rootPackageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };

  test("$schema major.minor matches the pinned @biomejs/biome devDependency major.minor", () => {
    const pinned = rootPackageJson.devDependencies?.["@biomejs/biome"];
    expect(pinned, "root devDependencies['@biomejs/biome'] must be pinned").toBeDefined();
    const pinnedMajorMinor = (pinned ?? "").split(".").slice(0, 2).join(".");
    expect(pinnedMajorMinor.length).toBeGreaterThan(0);

    const schema = config.$schema ?? "";
    const schemaVersionMatch = schema.match(/schemas\/(\d+\.\d+)\.\d+\/schema\.json/);
    expect(schemaVersionMatch, `$schema '${schema}' must reference a versioned schema URL`).toBeTruthy();
    expect(schemaVersionMatch?.[1]).toBe(pinnedMajorMinor);
  });

  test("does not use the deprecated top-level 'organizeImports' key removed by Biome v2", () => {
    expect(config.organizeImports).toBeUndefined();
  });

  test("does not use the deprecated 'files.ignore' / 'linter.ignore' arrays replaced by files.includes", () => {
    expect(config.files?.ignore).toBeUndefined();
    expect(config.linter?.ignore).toBeUndefined();
  });

  test("does not use the deprecated 'linter.rules.recommended' boolean form (use 'rules.preset' instead)", () => {
    // Confirmed against the real pinned 2.5.x binary: {"rules":{"recommended":true}}
    // is accepted but reports a DEPRECATED diagnostic ("Use preset instead");
    // {"rules":{"preset":"recommended"}} is the accepted current replacement.
    const rules = config.linter?.rules as { recommended?: unknown; preset?: unknown } | undefined;
    expect(rules?.recommended, "linter.rules.recommended is deprecated; use linter.rules.preset instead").toBeUndefined();
  });

  test("linter remains enabled with the current recommended preset configured", () => {
    expect(config.linter?.enabled).toBe(true);
    const rules = config.linter?.rules as { preset?: unknown } | undefined;
    expect(rules?.preset, "linter.rules.preset must be set (e.g. 'recommended')").toBeDefined();
  });

  test(
    "the real pinned binary emits no DEPRECATED configuration diagnostic for the checked-in biome.json",
    () => {
      const bin = requireLocalBiomeBin();
      const proc = Bun.spawnSync({ cmd: [bin, "lint", "index.ts"], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
      const stderr = proc.stderr.toString();
      expect(/DEPRECATED/i.test(stderr), stderr).toBe(false);
    },
    EXEC_TIMEOUT_MS,
  );
});

describe("reject broad-exclusion / negation-order regressions (edge cases, real-binary proof)", () => {
  test(
    "frontend/src, frontend/e2e, and frontend/playwright.config.ts are all simultaneously included by the pinned binary",
    () => {
      // Guards against a fix that only re-includes one representative
      // frontend path (e.g. only frontend/src) while leaving a differently
      // shaped negation/order trick still hiding frontend/e2e or the
      // Playwright config specifically.
      for (const p of ["frontend/src", "frontend/e2e", "frontend/playwright.config.ts"]) {
        expect(isPathIgnoredByPinnedBiome(p), `biome lint ${p} must not be ignored`).toBe(false);
      }
    },
    EXEC_TIMEOUT_MS,
  );
});
