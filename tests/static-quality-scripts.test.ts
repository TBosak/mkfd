import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the script/dependency-manifest contract from the
// `p1-static-quality-contract` requirements brief (roadmap Packet 1, C3 + H2,
// with the E8 dependency-classification overlap limited to the two pinned
// quality tools).
//
// Static assertions (manifest parsing, forbidden-pattern detection) stay
// offline and deterministic. The "does this script actually run its tool"
// requirement, however, cannot be proven by parsing text alone (a
// `"lint:root": "bun scripts/noop.ts"` or `"lint": "echo lint:root
// lint:frontend"` stub reads fine syntactically) - so this suite also
// *executes* the real scripts via `bun run <name>` and inspects Biome's own
// distinctive "Checked N files" banner / TypeScript's own `--listFilesOnly`
// dry-run file list, which only the real pinned local tool can produce.
//
// To keep this genuinely offline (no `bunx`-triggered network fallback), the
// execution-based tests never invoke `bunx <pkg>` directly: they either run
// the package.json script by name (which fails fast with "Script not found"
// if absent - no network involved) or resolve the *local* pinned binary
// path under node_modules/.bin first and fail with a clear message if it
// isn't installed, rather than letting bunx silently reach for the network.
//
// Non-goal reminder: these tests do not require the hundreds of existing
// application lint/type diagnostics to be clean; they only specify the
// manifest-level script/dependency contract and prove real tool coverage.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const EXEC_TIMEOUT_MS = 60_000;

interface PackageJsonShape {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(path: string): PackageJsonShape {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJsonShape;
}

const rootPackageJson = readPackageJson(join(REPO_ROOT, "package.json"));
const frontendPackageJson = readPackageJson(join(FRONTEND_DIR, "package.json"));

function scriptOrEmpty(pkg: PackageJsonShape, name: string): string {
  return pkg.scripts?.[name] ?? "";
}

// Exact pin: a bare `MAJOR.MINOR.PATCH`, with no semver range operator,
// build metadata, prerelease tag, "x"/"*" wildcard, or "latest" alias.
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;

function isExactPin(version: string | undefined): boolean {
  return typeof version === "string" && EXACT_SEMVER.test(version);
}

function extractFirstCommandToken(command: string): string {
  const trimmed = command.trim();
  const quoteChar = trimmed[0];
  if (quoteChar === '"' || quoteChar === "'") {
    const closingIndex = trimmed.indexOf(quoteChar, 1);
    if (closingIndex !== -1) return trimmed.slice(1, closingIndex);
  }
  return trimmed.split(/\s+/)[0] ?? "";
}

const PLATFORM_SHELL_EXECUTABLES = new Set([
  "sh",
  "bash",
  "zsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

/**
 * Returns a list of human-readable violation reasons for a package.json
 * script command, per the brief's "reject scripts that appear cross-platform
 * but delegate to sh/bash/cmd/PowerShell, or use &&, ;, or inline
 * NAME=value assignment" edge case, plus the "no globally downloaded latest
 * tool" edge case. An empty array means the command is conformant.
 */
function scriptViolations(command: string): string[] {
  const violations: string[] = [];
  if (command.trim().length === 0) return ["script is missing or empty"];

  if (/(^|[\s;&|])cd(\s|$)/.test(command)) violations.push("contains a 'cd' directory change");
  if (command.includes("&&")) violations.push("contains '&&' shell chaining");
  if (command.includes(";")) violations.push("contains ';' shell chaining");
  if (/^\s*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+\S/.test(command)) {
    violations.push("uses inline NAME=value environment assignment");
  }

  const firstToken = extractFirstCommandToken(command);
  const executable = (firstToken.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (PLATFORM_SHELL_EXECUTABLES.has(executable)) {
    violations.push(`delegates to platform-specific shell wrapper '${executable}'`);
  }

  if (/\bnpx\b/.test(command)) violations.push("uses npx instead of bun-managed tool resolution");
  if (/@latest\b/.test(command)) violations.push("pins to @latest instead of the locally pinned version");

  return violations;
}

describe("scriptViolations helper correctness", () => {
  test("flags cd, &&, ;, and inline env assignment", () => {
    expect(scriptViolations("cd frontend && bun run build")).toContain("contains a 'cd' directory change");
    expect(scriptViolations("cd frontend && bun run build")).toContain("contains '&&' shell chaining");
    expect(scriptViolations("bun run lint:root; bun run lint:frontend")).toContain("contains ';' shell chaining");
    expect(scriptViolations("PASSKEY=x bun index.ts")).toContain("uses inline NAME=value environment assignment");
  });

  test("flags shell-wrapper delegation, npx, and @latest", () => {
    expect(scriptViolations('bash -c "bun run lint"')).toEqual(
      expect.arrayContaining([expect.stringContaining("platform-specific shell wrapper")]),
    );
    expect(scriptViolations("npx @biomejs/biome lint .")).toContain(
      "uses npx instead of bun-managed tool resolution",
    );
    expect(scriptViolations("bunx @biomejs/biome@latest lint .")).toContain(
      "pins to @latest instead of the locally pinned version",
    );
  });

  test("allows a plain cross-platform bun invocation", () => {
    expect(scriptViolations("bunx @biomejs/biome lint .")).toEqual([]);
    expect(scriptViolations("bun run lint:root")).toEqual([]);
    expect(scriptViolations("bun scripts/verify-quality.ts lint")).toEqual([]);
  });

  test("does not false-positive on 'cd' appearing inside a longer word", () => {
    expect(scriptViolations("bun run typecheck:cdn-assets")).toEqual([]);
  });
});

describe("pinned quality-tool devDependencies (requirement 1)", () => {
  test("root package.json declares an exact-pinned @biomejs/biome devDependency", () => {
    const version = rootPackageJson.devDependencies?.["@biomejs/biome"];
    expect(version, "root devDependencies['@biomejs/biome'] must be declared").toBeDefined();
    expect(isExactPin(version), `@biomejs/biome version '${version}' must be an exact MAJOR.MINOR.PATCH pin`).toBe(
      true,
    );
  });

  test("root package.json declares an exact-pinned typescript devDependency", () => {
    const version = rootPackageJson.devDependencies?.typescript;
    expect(version, "root devDependencies['typescript'] must be declared").toBeDefined();
    expect(isExactPin(version), `typescript version '${version}' must be an exact MAJOR.MINOR.PATCH pin`).toBe(true);
  });

  test("frontend package.json pins typescript to an exact version, not a range", () => {
    const version = frontendPackageJson.devDependencies?.typescript;
    expect(version, "frontend devDependencies['typescript'] must be declared").toBeDefined();
    expect(isExactPin(version), `frontend typescript version '${version}' must be an exact MAJOR.MINOR.PATCH pin`).toBe(
      true,
    );
  });

  test("root and frontend typescript devDependency versions are identical, not merely compatible", () => {
    const rootVersion = rootPackageJson.devDependencies?.typescript;
    const frontendVersion = frontendPackageJson.devDependencies?.typescript;
    expect(rootVersion, "root typescript version must be declared").toBeDefined();
    expect(frontendVersion, "frontend typescript version must be declared").toBeDefined();
    expect(rootVersion).toBe(frontendVersion);
  });

  test("neither pinned version uses a semver range prefix, wildcard, or prerelease/build tag", () => {
    const rejected = [
      "^5.9.3",
      "~5.9.3",
      ">=5.9.3",
      "5.x",
      "5.9.*",
      "5.9.3-beta.1",
      "5.9.3+build.7",
      "latest",
      "workspace:*",
    ];
    for (const bad of rejected) {
      expect(isExactPin(bad), `'${bad}' must not be treated as an exact pin`).toBe(false);
    }
  });
});

describe("root aggregate/half scripts exist and are platform-neutral (requirement 2)", () => {
  const requiredScripts = ["lint:root", "lint:frontend", "typecheck:root", "typecheck:frontend", "lint", "typecheck"];

  for (const name of requiredScripts) {
    test(`root package.json declares a '${name}' script`, () => {
      expect(rootPackageJson.scripts?.[name], `scripts['${name}'] must be defined`).toBeDefined();
      expect((rootPackageJson.scripts?.[name] ?? "").trim().length).toBeGreaterThan(0);
    });
  }

  for (const name of requiredScripts) {
    test(`root '${name}' script has no cd/shell-chaining/inline-env/shell-wrapper/npx/@latest violations`, () => {
      const command = scriptOrEmpty(rootPackageJson, name);
      expect(command.length, `scripts['${name}'] must exist to be checked`).toBeGreaterThan(0);
      expect(scriptViolations(command), `scripts['${name}'] = '${command}'`).toEqual([]);
    });
  }

  test("aggregate 'lint' is not textually identical to either half script (does not invoke only one half)", () => {
    const aggregate = scriptOrEmpty(rootPackageJson, "lint");
    const lintRoot = scriptOrEmpty(rootPackageJson, "lint:root");
    const lintFrontend = scriptOrEmpty(rootPackageJson, "lint:frontend");
    expect(aggregate.length).toBeGreaterThan(0);
    expect(aggregate).not.toBe(lintRoot);
    expect(aggregate).not.toBe(lintFrontend);
  });

  test("aggregate 'typecheck' is not textually identical to either half script (does not invoke only one half)", () => {
    const aggregate = scriptOrEmpty(rootPackageJson, "typecheck");
    const typecheckRoot = scriptOrEmpty(rootPackageJson, "typecheck:root");
    const typecheckFrontend = scriptOrEmpty(rootPackageJson, "typecheck:frontend");
    expect(aggregate.length).toBeGreaterThan(0);
    expect(aggregate).not.toBe(typecheckRoot);
    expect(aggregate).not.toBe(typecheckFrontend);
  });

  test("aggregate 'lint' is not a bare single-target 'bun run <one half>' invocation", () => {
    const aggregate = scriptOrEmpty(rootPackageJson, "lint").trim();
    expect(aggregate.length).toBeGreaterThan(0);
    expect(/^bun run (lint:root|lint:frontend)$/.test(aggregate)).toBe(false);
  });

  test("aggregate 'typecheck' is not a bare single-target 'bun run <one half>' invocation", () => {
    const aggregate = scriptOrEmpty(rootPackageJson, "typecheck").trim();
    expect(aggregate.length).toBeGreaterThan(0);
    expect(/^bun run (typecheck:root|typecheck:frontend)$/.test(aggregate)).toBe(false);
  });

  test("aggregate 'lint' does not recurse into itself", () => {
    const aggregate = scriptOrEmpty(rootPackageJson, "lint");
    expect(aggregate.length).toBeGreaterThan(0);
    expect(/\brun\s+lint\b(?!:(root|frontend))/.test(aggregate)).toBe(false);
  });

  test("aggregate 'typecheck' does not recurse into itself", () => {
    const aggregate = scriptOrEmpty(rootPackageJson, "typecheck");
    expect(aggregate.length).toBeGreaterThan(0);
    expect(/\brun\s+typecheck\b(?!:(root|frontend))/.test(aggregate)).toBe(false);
  });

  test("half scripts reference the pinned tool without an explicit conflicting version suffix", () => {
    for (const name of ["lint:root", "lint:frontend"]) {
      const command = scriptOrEmpty(rootPackageJson, name);
      expect(command.length, `scripts['${name}'] must exist`).toBeGreaterThan(0);
      const versionSuffixMatch = command.match(/@biomejs\/biome@([^\s]+)/);
      if (versionSuffixMatch) {
        expect(versionSuffixMatch[1]).toBe(rootPackageJson.devDependencies?.["@biomejs/biome"]);
      }
    }
    for (const name of ["typecheck:root", "typecheck:frontend"]) {
      const command = scriptOrEmpty(rootPackageJson, name);
      expect(command.length, `scripts['${name}'] must exist`).toBeGreaterThan(0);
      const versionSuffixMatch = command.match(/\btypescript@([^\s]+)/);
      if (versionSuffixMatch) {
        expect(versionSuffixMatch[1]).toBe(rootPackageJson.devDependencies?.typescript);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Behavioral proof that the scripts above actually run their tool, rather
// than a no-op stub or an `echo` fake. Biome prints a distinctive
// "Checked N files in ..." banner that only the real binary produces;
// TypeScript's `--listFilesOnly` dry-run prints the real resolved file list.
// Neither can be faked by text that merely mentions script names.
// ---------------------------------------------------------------------------

function localBinPath(dir: string, name: string): string | null {
  const dotBin = join(dir, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? [join(dotBin, `${name}.exe`), join(dotBin, `${name}.CMD`), join(dotBin, `${name}.cmd`)]
      : [join(dotBin, name)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runBunScript(cwd: string, scriptName: string, extraArgs: string[] = []) {
  const args = extraArgs.length > 0 ? ["run", scriptName, "--", ...extraArgs] : ["run", scriptName];
  const proc = Bun.spawnSync({ cmd: ["bun", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { exitCode: proc.exitCode ?? 1, stdout, stderr, combined: `${stdout}\n${stderr}` };
}

function parseCheckedFileCounts(output: string): number[] {
  return [...output.matchAll(/Checked (\d+) files? in/g)].map((m) => Number(m[1]));
}

/**
 * Parses Biome's `--verbose` "Files processed:" listing into the real,
 * individual relative file paths it actually walked - not just an
 * aggregate count. This is what closes the "both halves secretly run the
 * same whole-repo command" false positive: a count-only comparison (e.g.
 * "aggregate checked more files than lint:root alone") is satisfied even
 * when lint:root itself already scans all of frontend, so scoping must be
 * proven from the actual per-file list, not a sum.
 */
function parseVerboseProcessedFiles(output: string): string[] {
  const section = output.split("Files processed:")[1]?.split("Files fixed:")[0] ?? "";
  return [...section.matchAll(/^\s*-\s+(.+?)\r?$/gm)].map((m) => m[1].trim().replaceAll("\\", "/"));
}

function runVerboseBunScript(cwd: string, scriptName: string) {
  const { combined } = runBunScript(cwd, scriptName, ["--verbose"]);
  return { files: parseVerboseProcessedFiles(combined), combined };
}

function normalizeListedPath(p: string): string {
  return p.replace(/\r$/, "").replaceAll("\\", "/");
}

function listFilesOnlyOutput(cwd: string, scriptName: string): string[] {
  const { stdout } = runBunScript(cwd, scriptName, ["--listFilesOnly"]);
  return stdout
    .split("\n")
    .map(normalizeListedPath)
    .map((line) => line.trim())
    .filter(Boolean);
}

function containsProductionPath(files: string[], suffix: string): boolean {
  return files.some((f) => !f.includes("node_modules") && f.endsWith(suffix));
}

describe("root lint half/aggregate scripts run the real pinned Biome tool (requirement 1, 2)", () => {
  test("root pinned biome binary is installed locally (prerequisite for the following behavioral proofs)", () => {
    expect(
      localBinPath(REPO_ROOT, "biome"),
      "no local node_modules/.bin/biome(.exe) found - pin @biomejs/biome as a root devDependency and run `bun install`",
    ).not.toBeNull();
  });

  test(
    "'lint:root' processes real root files and ZERO frontend files (root half is genuinely scoped, not a whole-repo run)",
    () => {
      const { files, combined } = runVerboseBunScript(REPO_ROOT, "lint:root");
      expect(files.length, combined).toBeGreaterThan(0);
      expect(
        files.filter((f) => f.startsWith("frontend/")),
        `lint:root must not process any frontend/ file; processed files:\n${files.join("\n")}`,
      ).toEqual([]);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "'lint:frontend' processes only frontend files (frontend half is genuinely scoped, not a whole-repo run)",
    () => {
      const { files, combined } = runVerboseBunScript(REPO_ROOT, "lint:frontend");
      expect(files.length, combined).toBeGreaterThan(0);
      expect(
        files.filter((f) => !f.startsWith("frontend/")),
        `lint:frontend must only process frontend/ files; processed files:\n${files.join("\n")}`,
      ).toEqual([]);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "aggregate 'lint' processes at least one non-frontend root file AND at least one frontend file (both distinct halves genuinely ran)",
    () => {
      const { files, combined } = runVerboseBunScript(REPO_ROOT, "lint");
      const hasRootFile = files.some((f) => !f.startsWith("frontend/"));
      const hasFrontendFile = files.some((f) => f.startsWith("frontend/"));
      expect(hasRootFile, `aggregate lint must process at least one non-frontend file:\n${combined}`).toBe(true);
      expect(hasFrontendFile, `aggregate lint must process at least one frontend/ file:\n${combined}`).toBe(true);
    },
    EXEC_TIMEOUT_MS,
  );
});

describe("root typecheck half/aggregate scripts cover the real resolved TypeScript file sets (requirement 1, 2, 6, 7)", () => {
  test(
    "'typecheck:root' dry-run file list includes root application source and excludes frontend",
    () => {
      const files = listFilesOnlyOutput(REPO_ROOT, "typecheck:root");
      expect(containsProductionPath(files, "/index.ts"), files.slice(0, 20).join("\n")).toBe(true);
      expect(files.some((f) => f.includes("/frontend/")), files.slice(0, 20).join("\n")).toBe(false);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "'typecheck:frontend' dry-run file list includes both frontend app source and E2E files",
    () => {
      const files = listFilesOnlyOutput(REPO_ROOT, "typecheck:frontend");
      expect(containsProductionPath(files, "frontend/src/App.tsx"), files.slice(0, 20).join("\n")).toBe(true);
      expect(containsProductionPath(files, "frontend/e2e/fixtures.ts"), files.slice(0, 20).join("\n")).toBe(true);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "aggregate 'typecheck' dry-run file list covers root, frontend app, and frontend E2E together",
    () => {
      const files = listFilesOnlyOutput(REPO_ROOT, "typecheck");
      expect(containsProductionPath(files, "/index.ts"), files.slice(0, 20).join("\n")).toBe(true);
      expect(containsProductionPath(files, "frontend/src/App.tsx"), files.slice(0, 20).join("\n")).toBe(true);
      expect(containsProductionPath(files, "frontend/e2e/fixtures.ts"), files.slice(0, 20).join("\n")).toBe(true);
    },
    EXEC_TIMEOUT_MS,
  );
});

describe("frontend local lint/typecheck scripts (requirement 3)", () => {
  test("frontend package.json declares a 'lint' script", () => {
    expect(frontendPackageJson.scripts?.lint, "frontend scripts.lint must be defined").toBeDefined();
    expect((frontendPackageJson.scripts?.lint ?? "").trim().length).toBeGreaterThan(0);
  });

  test("frontend package.json declares a 'typecheck' script", () => {
    expect(frontendPackageJson.scripts?.typecheck, "frontend scripts.typecheck must be defined").toBeDefined();
    expect((frontendPackageJson.scripts?.typecheck ?? "").trim().length).toBeGreaterThan(0);
  });

  test("frontend 'lint' and 'typecheck' scripts have no cd/shell-chaining/inline-env/shell-wrapper/npx/@latest violations", () => {
    for (const name of ["lint", "typecheck"]) {
      const command = frontendPackageJson.scripts?.[name] ?? "";
      expect(command.length, `frontend scripts['${name}'] must exist to be checked`).toBeGreaterThan(0);
      expect(scriptViolations(command), `frontend scripts['${name}'] = '${command}'`).toEqual([]);
    }
  });

  test("frontend either omits @biomejs/biome or pins the exact same version as root (no drift, no range)", () => {
    // The repository has separate root/frontend manifests and lockfiles, so
    // frontend declaring its own @biomejs/biome dependency is a valid local
    // arrangement - what the brief forbids is *drift*: a frontend pin that
    // differs from, or is a looser range than, the shared root-pinned
    // version. Omitting it entirely (relying on bun's node_modules walk-up
    // to the root install) is equally valid.
    const frontendVersion = frontendPackageJson.devDependencies?.["@biomejs/biome"];
    if (frontendVersion === undefined) return;
    expect(isExactPin(frontendVersion), `frontend @biomejs/biome version '${frontendVersion}' must be an exact pin`).toBe(
      true,
    );
    expect(frontendVersion).toBe(rootPackageJson.devDependencies?.["@biomejs/biome"]);
  });

  test(
    "frontend 'lint' actually invokes the real, correctly-pinned biome binary",
    () => {
      // Whether frontend relies on bun's node_modules walk-up to the shared
      // root install, or declares its own identical exact pin (both valid
      // per the previous test), running the script for real from cwd=frontend
      // must reach a genuine biome binary and produce its distinctive
      // "Checked N files" banner - proving the wiring actually works either way.
      const { combined } = runBunScript(FRONTEND_DIR, "lint");
      expect(parseCheckedFileCounts(combined).length, combined).toBeGreaterThanOrEqual(1);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "frontend 'typecheck' dry-run file list covers both app src and the E2E surface (not silently omitting E2E)",
    () => {
      const files = listFilesOnlyOutput(FRONTEND_DIR, "typecheck");
      expect(containsProductionPath(files, "src/App.tsx"), files.slice(0, 20).join("\n")).toBe(true);
      expect(containsProductionPath(files, "e2e/fixtures.ts"), files.slice(0, 20).join("\n")).toBe(true);
      expect(containsProductionPath(files, "playwright.config.ts"), files.slice(0, 20).join("\n")).toBe(true);
    },
    EXEC_TIMEOUT_MS,
  );
});

describe("script wiring does not rely on a globally downloaded latest tool (requirement 1 + edge cases)", () => {
  const allScriptEntries = [
    ...Object.entries(rootPackageJson.scripts ?? {}),
    ...Object.entries(frontendPackageJson.scripts ?? {}).map(([name, cmd]) => [`frontend:${name}`, cmd] as const),
  ];

  test("no script in either manifest uses npx or an explicit @latest tag", () => {
    const offenders = allScriptEntries.filter(([, command]) => /\bnpx\b/.test(command) || /@latest\b/.test(command));
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });
});

describe("unchanged compatibility surface (requirement 9)", () => {
  const requiredRootScripts = [
    "build",
    "start",
    "dev",
    "db:generate",
    "validate:catalog",
    "test",
    "test:e2e",
    "verify:static",
    "verify:core",
    "verify:full",
    "tdd:claude",
    "tdd:tests",
  ];

  for (const name of requiredRootScripts) {
    test(`root script entry point '${name}' remains present and non-empty`, () => {
      expect(rootPackageJson.scripts?.[name], `scripts['${name}'] must still exist`).toBeDefined();
      expect((rootPackageJson.scripts?.[name] ?? "").trim().length).toBeGreaterThan(0);
    });
  }

  test("verify:static still composes lint and typecheck", () => {
    const command = scriptOrEmpty(rootPackageJson, "verify:static");
    expect(/\blint\b/.test(command)).toBe(true);
    expect(/\btypecheck\b/.test(command)).toBe(true);
  });

  test("verify:core still composes verify:static, test, validate:catalog, and build", () => {
    const command = scriptOrEmpty(rootPackageJson, "verify:core");
    expect(/verify:static/.test(command)).toBe(true);
    expect(/\btest\b/.test(command)).toBe(true);
    expect(/validate:catalog/.test(command)).toBe(true);
    expect(/\bbuild\b/.test(command)).toBe(true);
  });

  test("verify:full still composes verify:core and test:e2e", () => {
    const command = scriptOrEmpty(rootPackageJson, "verify:full");
    expect(/verify:core/.test(command)).toBe(true);
    expect(/test:e2e/.test(command)).toBe(true);
  });

  test("frontend build script is unchanged (frontend production build behavior invariant)", () => {
    expect(frontendPackageJson.scripts?.build).toBe("tsc && vite build");
  });

  test("frontend test (Playwright) script is unchanged", () => {
    expect(frontendPackageJson.scripts?.test).toBe("playwright test");
  });
});
