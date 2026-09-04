import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the `p1-fallow-static-analysis-gate` requirements brief
// (Packet 1 follow-up, extending B4 + the S10 static-analysis portion):
//
//   1. Worker entry points are load-bearing (declared, not ignore-based).
//   2. The nine provably-dead starter-config adapters are removed.
//   3. `domhandler` is declared in the ROOT manifest, and no production
//      source file imports a package absent from its owning manifest.
//   6. `ignorePatterns` / a saved baseline / suppression comments cannot be
//      used to quarantine first-party findings wholesale.
//   6 (checklist) Roadmap-pending components are proven to still exist.
//
// All real `fallow` invocations in this file go through a single
// module-level cache (`runFallow`) keyed by argv, per the brief's "reuse a
// single fallow invocation per test process" instruction - the binary is
// fast (~0.1-1s per run over 2965 files) but still real work worth sharing
// across every describe block below.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const EXEC_TIMEOUT_MS = 30_000;
const REAL_FALLOWRC_PATH = join(REPO_ROOT, ".fallowrc.json");

function localFallowBinPath(): string {
  const dotBin = join(REPO_ROOT, "node_modules", ".bin");
  return process.platform === "win32" ? join(dotBin, "fallow.exe") : join(dotBin, "fallow");
}

interface FallowRunResult {
  exit: number;
  out: string;
  err: string;
}

const fallowRunCache = new Map<string, FallowRunResult>();
const scratchDirs: string[] = [];

function runFallow(args: string[]): FallowRunResult {
  const key = JSON.stringify(args);
  const cached = fallowRunCache.get(key);
  if (cached) return cached;
  const bin = localFallowBinPath();
  expect(existsSync(bin), `no local fallow binary found at ${bin}`).toBe(true);
  const proc = Bun.spawnSync({ cmd: [bin, ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  const result: FallowRunResult = {
    exit: proc.exitCode ?? 1,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  };
  fallowRunCache.set(key, result);
  return result;
}

interface DeadCodeFileFinding {
  path: string;
}

interface DeadCodeUnlistedDependency {
  package_name: string;
  imported_from: Array<{ path: string; line: number; col: number }>;
}

interface DeadCodeReport {
  unused_files?: DeadCodeFileFinding[];
  unused_exports?: Array<{ path: string; export_name?: string }>;
  unused_types?: Array<{ path: string }>;
  unlisted_dependencies?: DeadCodeUnlistedDependency[];
  circular_dependencies?: Array<{ files: string[] }>;
  entry_points?: { total: number; sources: Record<string, number> };
}

function runDeadCode(extraArgs: string[] = []): DeadCodeReport {
  const { out } = runFallow(["dead-code", "--format", "json", "--quiet", ...extraArgs]);
  return JSON.parse(out) as DeadCodeReport;
}

/** Writes a temp `.fallowrc.json` variant and returns its path; every directory created this way is removed in `afterAll`. */
function writeTempConfig(config: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "fallow-gate-probe-"));
  scratchDirs.push(dir);
  const path = join(dir, ".fallowrc.json");
  writeFileSync(path, JSON.stringify(config), "utf8");
  return path;
}

afterAll(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readRealFallowConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(REAL_FALLOWRC_PATH, "utf8")) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// requirement 1: worker entry points are load-bearing, not ignore-based
// ---------------------------------------------------------------------------

const WORKER_PATHS = ["workers/feed-updater.worker.ts", "workers/imap-feed.worker.ts"];

describe("sanity: both worker files exist and are spawned by path string, not statically imported (baseline from the brief)", () => {
  for (const workerPath of WORKER_PATHS) {
    test(`${workerPath} exists on disk`, () => {
      expect(existsSync(join(REPO_ROOT, workerPath))).toBe(true);
    });
  }

  test("utilities/worker-manager.utility.ts spawns both workers by a runtime path string (new Worker(\"./workers/...\"))", () => {
    const source = readFileSync(join(REPO_ROOT, "utilities", "worker-manager.utility.ts"), "utf8");
    expect(source).toMatch(/new Worker\(\s*\n?\s*feedConfig\.feedType === "email"/);
    expect(source).toContain("./workers/imap-feed.worker.ts");
    expect(source).toContain("./workers/feed-updater.worker.ts");
  });
});

describe("mechanism proof: an explicit `entry` declaration is what keeps a worker out of unused-files (control, independent of the committed config)", () => {
  test(
    "a config declaring both workers under `entry` reports neither as unused",
    () => {
      const base = readRealFallowConfig();
      const withEntry = { ...base, entry: [...WORKER_PATHS] };
      const configPath = writeTempConfig(withEntry);
      const report = runDeadCode(["--config", configPath]);
      const unusedPaths = (report.unused_files ?? []).map((f) => f.path);
      for (const workerPath of WORKER_PATHS) {
        expect(unusedPaths, `${workerPath} must not be unused when declared as an entry point`).not.toContain(workerPath);
      }
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "the same config with `entry` removed again reports both workers as unused (the mechanism is doing real work, not a no-op)",
    () => {
      const base = readRealFallowConfig();
      const withoutEntry = { ...base };
      delete (withoutEntry as { entry?: unknown }).entry;
      const configPath = writeTempConfig(withoutEntry);
      const report = runDeadCode(["--config", configPath]);
      const unusedPaths = (report.unused_files ?? []).map((f) => f.path);
      for (const workerPath of WORKER_PATHS) {
        expect(unusedPaths, `${workerPath} should be reported unused once its entry declaration is removed`).toContain(workerPath);
      }
    },
    EXEC_TIMEOUT_MS,
  );
});

describe("requirement 1 (RED until .fallowrc.json declares the worker entry points): the committed config keeps both workers out of unused-files", () => {
  test(
    "dead-code analysis under the real, committed .fallowrc.json does not report either worker as unused",
    () => {
      const report = runDeadCode();
      const unusedPaths = (report.unused_files ?? []).map((f) => f.path);
      for (const workerPath of WORKER_PATHS) {
        expect(
          unusedPaths,
          `${workerPath} must not appear in unused_files once it is declared as a real entry point in the committed .fallowrc.json`,
        ).not.toContain(workerPath);
      }
    },
    EXEC_TIMEOUT_MS,
  );

  test("the committed .fallowrc.json's `entry` array covers both worker paths (structural, not behavioral)", () => {
    const config = readRealFallowConfig();
    const entries = Array.isArray((config as { entry?: unknown }).entry) ? ((config as { entry: unknown[] }).entry as string[]) : [];
    const regexes = entries.map(globToRegExp);
    for (const workerPath of WORKER_PATHS) {
      const covered = regexes.some((re) => re.test(workerPath));
      expect(covered, `.fallowrc.json's 'entry' array must match ${workerPath}; got entry=${JSON.stringify(entries)}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// glob helpers, shared by the entry-coverage check above and the
// ignorePatterns-bounding anti-bypass suite below. Hand-rolled rather than a
// dependency, mirroring this repo's existing test-suite convention of small
// self-contained helpers (see tests/dependency-manifest-policy.test.ts's
// semver comparator).
// ---------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  const pattern = glob.startsWith("!") ? glob.slice(1) : glob;
  const regexSpecialChars = ".+^$" + "{}()|[]\\";
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (regexSpecialChars.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

/** Builds one concrete path guaranteed to match `glob` (every `*`/`**` segment replaced by a literal placeholder), so "does this glob touch directory X" can be answered by a simple string prefix check regardless of where in the pattern the wildcard sits. */
function sampleGlobMatch(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += "__deep__/probe";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "probe";
      }
    } else {
      out += c;
    }
  }
  return out;
}

/** True if the positive (non-`!`-prefixed) glob `pattern` could match at least one file under `dirPrefix` (an "a/b/" style project-root-relative prefix). A `!`-prefixed pattern only re-includes paths another pattern already excluded, so it can never itself be the cause of a directory being quarantined and is treated as not matching. */
function globCouldMatchWithinDir(pattern: string, dirPrefix: string): boolean {
  if (pattern.startsWith("!")) return false;
  return sampleGlobMatch(pattern).startsWith(dirPrefix);
}

describe("globToRegExp / globCouldMatchWithinDir helper correctness", () => {
  test("a literal path matches only itself", () => {
    expect(globToRegExp("workers/feed-updater.worker.ts").test("workers/feed-updater.worker.ts")).toBe(true);
    expect(globToRegExp("workers/feed-updater.worker.ts").test("workers/imap-feed.worker.ts")).toBe(false);
  });

  test("a single '*' matches within one path segment only", () => {
    const re = globToRegExp("workers/*.worker.ts");
    expect(re.test("workers/feed-updater.worker.ts")).toBe(true);
    expect(re.test("workers/nested/feed-updater.worker.ts")).toBe(false);
  });

  test("a '**' matches across path segments", () => {
    const re = globToRegExp("public/**");
    expect(re.test("public/a/b/c.js")).toBe(true);
    expect(re.test("public/a.js")).toBe(true);
  });

  test("sampleGlobMatch replaces '**' with a deep placeholder and '*' with a single-segment placeholder", () => {
    expect(sampleGlobMatch("utilities/**")).toBe("utilities/__deep__/probe");
    expect(sampleGlobMatch("workers/*.worker.ts")).toBe("workers/probe.worker.ts");
  });

  test("every sampleGlobMatch() output actually matches its own glob (self-consistency)", () => {
    for (const pattern of ["utilities/**", "workers/*.worker.ts", "frontend/src/components/ui/**", "public/**"]) {
      expect(globToRegExp(pattern).test(sampleGlobMatch(pattern)), pattern).toBe(true);
    }
  });

  test("globCouldMatchWithinDir detects a directory-wide '**' exclusion", () => {
    expect(globCouldMatchWithinDir("utilities/**", "utilities/")).toBe(true);
  });

  test("globCouldMatchWithinDir does not flag an unrelated directory's pattern", () => {
    expect(globCouldMatchWithinDir("public/**", "utilities/")).toBe(false);
  });

  test("globCouldMatchWithinDir detects a broad glob scoped to a subdirectory (the vendored-UI-primitives bypass shape)", () => {
    expect(globCouldMatchWithinDir("frontend/src/components/ui/**", "frontend/src/")).toBe(true);
    expect(globCouldMatchWithinDir("frontend/src/components/ui/*", "frontend/src/")).toBe(true);
  });

  test("globCouldMatchWithinDir treats a '!'-prefixed re-inclusion pattern as never matching (it cannot itself cause an exclusion)", () => {
    expect(globCouldMatchWithinDir("!utilities/**", "utilities/")).toBe(false);
  });

  test("globCouldMatchWithinDir does not flag a literal single-file path outside the forbidden dir prefix", () => {
    expect(globCouldMatchWithinDir("frontend/src/components/ui/accordion.tsx", "utilities/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requirement 6 (anti-bypass): ignorePatterns may only cover generated,
// vendored, and build output - never a whole first-party source directory -
// with the single named exception of an explicitly-listed (non-wildcard)
// vendored UI primitive file under frontend/src/components/ui/.
// ---------------------------------------------------------------------------

const FORBIDDEN_FIRST_PARTY_DIRS = ["utilities/", "routes/", "models/", "workers/", "lib/", "node/", "scripts/", "frontend/src/"];
const VENDORED_UI_PRIMITIVES_PREFIX = "frontend/src/components/ui/";

function isNamedVendoredUiPrimitiveException(pattern: string): boolean {
  const stripped = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  if (stripped.includes("*")) return false; // must be a literal file, not a glob
  return stripped.startsWith(VENDORED_UI_PRIMITIVES_PREFIX) && stripped.length > VENDORED_UI_PRIMITIVES_PREFIX.length;
}

describe("isNamedVendoredUiPrimitiveException helper correctness", () => {
  test("accepts a literal file under components/ui/", () => {
    expect(isNamedVendoredUiPrimitiveException("frontend/src/components/ui/accordion.tsx")).toBe(true);
  });

  test("rejects a glob under components/ui/, even a narrow one", () => {
    expect(isNamedVendoredUiPrimitiveException("frontend/src/components/ui/*.tsx")).toBe(false);
    expect(isNamedVendoredUiPrimitiveException("frontend/src/components/ui/**")).toBe(false);
  });

  test("rejects the bare directory itself", () => {
    expect(isNamedVendoredUiPrimitiveException("frontend/src/components/ui/")).toBe(false);
  });

  test("rejects a literal file outside components/ui/", () => {
    expect(isNamedVendoredUiPrimitiveException("frontend/src/lib/utils.ts")).toBe(false);
  });
});

describe("ignorePatterns never excludes a whole first-party source directory (requirement 6, anti-bypass)", () => {
  test("no ignorePatterns entry in the committed .fallowrc.json matches within utilities/, routes/, models/, workers/, lib/, node/, scripts/, or frontend/src/, unless it is a named (non-wildcard) vendored UI primitive file", () => {
    const config = readRealFallowConfig();
    const patterns = Array.isArray((config as { ignorePatterns?: unknown }).ignorePatterns)
      ? ((config as { ignorePatterns: unknown[] }).ignorePatterns as string[])
      : [];
    const offenders: string[] = [];
    for (const pattern of patterns) {
      if (isNamedVendoredUiPrimitiveException(pattern)) continue;
      for (const dir of FORBIDDEN_FIRST_PARTY_DIRS) {
        if (globCouldMatchWithinDir(pattern, dir)) {
          offenders.push(`'${pattern}' matches within '${dir}'`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("no ignorePatterns entry specifically covers either worker path (requirement 1: entry-point declaration only, never an ignore)", () => {
    const config = readRealFallowConfig();
    const patterns = Array.isArray((config as { ignorePatterns?: unknown }).ignorePatterns)
      ? ((config as { ignorePatterns: unknown[] }).ignorePatterns as string[])
      : [];
    for (const workerPath of WORKER_PATHS) {
      const matched = patterns.filter((p) => globToRegExp(p).test(workerPath));
      expect(matched, `${workerPath} must not be matched by any ignorePatterns entry: ${JSON.stringify(matched)}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// requirement 6 (anti-bypass): a saved fallow baseline may not be used to
// quarantine the current backlog wholesale.
// ---------------------------------------------------------------------------

describe("no saved regression baseline embeds/quarantines the current backlog (requirement 6, anti-bypass)", () => {
  test("the committed .fallowrc.json declares no 'regression' baseline at all", () => {
    const config = readRealFallowConfig();
    expect((config as { regression?: unknown }).regression, "config must not embed a regression.baseline").toBeUndefined();
  });

  test("no committed '.fallow/baseline*.json' (or similarly named) snapshot file exists in the repo", () => {
    const candidateDirs = [REPO_ROOT, join(REPO_ROOT, ".fallow")];
    const offenders: string[] = [];
    for (const dir of candidateDirs) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        if (/baseline/i.test(entry)) offenders.push(join(dir, entry));
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// requirement 6 (anti-bypass): suppression comments must be counted and held
// at an explicit ceiling so findings cannot be silenced file by file.
// Authoring-time baseline (confirmed via `fallow suppressions`): 0.
// ---------------------------------------------------------------------------

function discoverFilesRecursive(dir: string, extensionPattern: RegExp): string[] {
  const results: string[] = [];
  function walk(current: string) {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(join(current, entry.name));
      } else if (entry.isFile() && extensionPattern.test(entry.name)) {
        results.push(join(current, entry.name));
      }
    }
  }
  walk(dir);
  return results;
}

const SUPPRESSION_CEILING_DIRS = ["utilities", "routes", "models", "workers", "lib", "node", "scripts", "frontend/src"];

function countSuppressionComments(): number {
  let total = 0;
  for (const dir of SUPPRESSION_CEILING_DIRS) {
    const files = discoverFilesRecursive(join(REPO_ROOT, dir), /\.tsx?$/);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const matches = source.match(/fallow-ignore-file|fallow-ignore-next-line/g);
      total += matches ? matches.length : 0;
    }
  }
  return total;
}

describe("suppression-comment ceiling (requirement 6, anti-bypass)", () => {
  test("fallow-ignore-file / fallow-ignore-next-line comments in first-party source do not exceed the pre-slice baseline of 0", () => {
    expect(countSuppressionComments()).toBeLessThanOrEqual(0);
  });

  test(
    "the real 'fallow suppressions' inventory agrees: zero active suppression markers in the repo",
    () => {
      const { out } = runFallow(["suppressions", "--format", "json", "--quiet"]);
      const data = JSON.parse(out) as { summary?: { total?: number } };
      expect(data.summary?.total ?? -1).toBe(0);
    },
    EXEC_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// requirement 3: domhandler is declared in the root manifest at a version
// matching the resolved graph, and no production source file imports a
// package absent from its owning manifest (import / import type / require).
// ---------------------------------------------------------------------------

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(path: string): PackageJsonShape {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJsonShape;
}

const rootPackageJson = readPackageJson(join(REPO_ROOT, "package.json"));

function resolvedLockVersion(packageName: string): string | null {
  const lock = readFileSync(join(REPO_ROOT, "bun.lock"), "utf8");
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${escaped}":\\s*\\["${escaped}@([\\d.]+)"`).exec(lock);
  return match ? match[1] : null;
}

/** Whether `range` (a plain ^, ~, exact, or >= registry range - the same safe forms `dependency-manifest-policy.test.ts` accepts) is satisfied by `resolvedVersion`. */
function rangeSatisfiedBy(range: string | undefined, resolvedVersion: string): boolean {
  if (!range) return false;
  const trimmed = range.trim();
  const parse = (v: string) => v.split(".").map(Number) as [number, number, number];
  const [rMajor, rMinor, rPatch] = parse(resolvedVersion);
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (caret) {
    const [, maj, min, pat] = caret.map(Number);
    if (rMajor !== maj) return false;
    return rMinor > min || (rMinor === min && rPatch >= pat);
  }
  const tilde = /^~(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (tilde) {
    const [, maj, min, pat] = tilde.map(Number);
    return rMajor === maj && rMinor === min && rPatch >= pat;
  }
  const gte = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (gte) {
    const [, maj, min, pat] = gte.map(Number);
    if (rMajor !== maj) return rMajor > maj;
    if (rMinor !== min) return rMinor > min;
    return rPatch >= pat;
  }
  const exact = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (exact) {
    const [, maj, min, pat] = exact.map(Number);
    return rMajor === maj && rMinor === min && rPatch === pat;
  }
  return false;
}

describe("rangeSatisfiedBy helper correctness", () => {
  test("a caret range is satisfied by an equal-or-greater patch/minor within the same major", () => {
    expect(rangeSatisfiedBy("^5.0.3", "5.0.3")).toBe(true);
    expect(rangeSatisfiedBy("^5.0.0", "5.0.3")).toBe(true);
    expect(rangeSatisfiedBy("^5.0.4", "5.0.3")).toBe(false);
    expect(rangeSatisfiedBy("^4.9.9", "5.0.3")).toBe(false);
  });

  test("a tilde range only allows patch movement within the same minor", () => {
    expect(rangeSatisfiedBy("~5.0.0", "5.0.3")).toBe(true);
    expect(rangeSatisfiedBy("~5.1.0", "5.0.3")).toBe(false);
  });

  test("an exact pin only matches the identical version", () => {
    expect(rangeSatisfiedBy("5.0.3", "5.0.3")).toBe(true);
    expect(rangeSatisfiedBy("5.0.2", "5.0.3")).toBe(false);
  });

  test("undefined range is never satisfied", () => {
    expect(rangeSatisfiedBy(undefined, "5.0.3")).toBe(false);
  });
});

describe("sanity: domhandler resolves to a single hoisted version in the lockfile", () => {
  test("bun.lock resolves domhandler to 5.0.3 (cheerio's hoisted transitive copy)", () => {
    expect(resolvedLockVersion("domhandler")).toBe("5.0.3");
  });
});

describe("requirement 3 (RED until package.json declares domhandler): the root manifest declares domhandler at the resolved version", () => {
  test("root package.json dependencies['domhandler'] is declared and satisfied by the resolved lockfile version", () => {
    const resolved = resolvedLockVersion("domhandler");
    expect(resolved, "sanity: bun.lock must resolve a domhandler version").not.toBeNull();
    const range = rootPackageJson.dependencies?.domhandler;
    expect(range, "package.json dependencies['domhandler'] must be declared").toBeDefined();
    expect(
      rangeSatisfiedBy(range, resolved as string),
      `dependencies['domhandler'] = '${range}' must be satisfied by the resolved version ${resolved}`,
    ).toBe(true);
  });
});

// --- structural import scanner: import / import type / side-effect import / require ---

function extractBareImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromImport = /\bimport\s+(?:type\s+)?(?:[\w*${},\s]+\s+from\s+)?["']([^"']+)["']/g;
  for (const m of source.matchAll(fromImport)) specifiers.push(m[1]);
  const requireCall = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(requireCall)) specifiers.push(m[1]);
  return specifiers;
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  return parts[0];
}

describe("extractBareImportSpecifiers / packageNameFromSpecifier helper correctness", () => {
  test("extracts a plain named import specifier", () => {
    expect(extractBareImportSpecifiers('import { AnyNode } from "domhandler";')).toEqual(["domhandler"]);
  });

  test("extracts an 'import type' specifier", () => {
    expect(extractBareImportSpecifiers('import type { Element } from "domhandler";')).toEqual(["domhandler"]);
  });

  test("extracts a side-effect-only import", () => {
    expect(extractBareImportSpecifiers('import "domhandler";')).toEqual(["domhandler"]);
  });

  test("extracts a require() call", () => {
    expect(extractBareImportSpecifiers('const d = require("domhandler");')).toEqual(["domhandler"]);
  });

  test("packageNameFromSpecifier resolves a scoped package to its scope/name pair", () => {
    expect(packageNameFromSpecifier("@xmldom/xmldom")).toBe("@xmldom/xmldom");
    expect(packageNameFromSpecifier("@xmldom/xmldom/lib/dom")).toBe("@xmldom/xmldom");
  });

  test("packageNameFromSpecifier resolves an unscoped subpath import to its top-level package", () => {
    expect(packageNameFromSpecifier("domhandler/lib/node")).toBe("domhandler");
  });

  test("packageNameFromSpecifier returns null for relative and node: specifiers", () => {
    expect(packageNameFromSpecifier("./local")).toBeNull();
    expect(packageNameFromSpecifier("../local")).toBeNull();
    expect(packageNameFromSpecifier("node:fs")).toBeNull();
  });
});

const ROOT_PRODUCTION_EXCLUDED_DIR_NAMES = new Set(["frontend", "node_modules", "public", "tests", ".git"]);

function rootProductionSourceFiles(): string[] {
  const results: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ROOT_PRODUCTION_EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        results.push(join(current, entry.name));
      }
    }
  }
  walk(REPO_ROOT);
  return results;
}

// Scoped to the single package this slice owns (`domhandler`, the baseline's
// one unlisted dependency), rather than a blanket "every bare import must be
// declared" sweep: the repo has other bare specifiers (Node builtins used
// without a `node:` prefix such as `crypto`, Bun's virtual `bun` module, and
// pre-existing transitively-resolved packages like `libmime` that fallow's
// own oracle does not flag) whose declaration policy belongs to unrelated,
// out-of-scope work. Using the same import/type/require-aware structural
// scanner keeps the assertion real rather than hardcoding the 3 known call
// sites, so a new domhandler import anywhere would also be caught.
describe("requirement 3 (RED until domhandler is declared): no root production source file imports 'domhandler' without it being declared in the ROOT manifest", () => {
  const declaredRootPackages = new Set([
    ...Object.keys(rootPackageJson.dependencies ?? {}),
    ...Object.keys(rootPackageJson.devDependencies ?? {}),
  ]);

  test("rootProductionSourceFiles() discovers the three known domhandler-importing utility files (sanity check for the scan itself)", () => {
    const normalized = rootProductionSourceFiles().map((f) => f.replaceAll("\\", "/"));
    expect(normalized.some((f) => f.endsWith("/utilities/form-detection.utility.ts"))).toBe(true);
    expect(normalized.some((f) => f.endsWith("/utilities/rss-builder.utility.ts"))).toBe(true);
    expect(normalized.some((f) => f.endsWith("/utilities/selector-suggestion.utility.ts"))).toBe(true);
  });

  test("every 'domhandler' import (import / import type / require) in root production source resolves to a package declared in root package.json (this must not be satisfiable by declaring it in frontend/package.json instead)", () => {
    const violations: string[] = [];
    for (const file of rootProductionSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractBareImportSpecifiers(source)) {
        const pkg = packageNameFromSpecifier(specifier);
        if (pkg !== "domhandler") continue;
        if (!declaredRootPackages.has(pkg)) {
          violations.push(`${file.replace(REPO_ROOT, "")}: imports undeclared package '${pkg}' (via '${specifier}')`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lead review gap 1: the domhandler-scoped sweep above proves the *instance*
// is fixed but leaves the defect *class* open - a future bare import of any
// other undeclared package (e.g. `htmlparser2`, hoisted via cheerio exactly
// like `domhandler`) would pass every test in this suite. This block adds a
// general sweep of every bare specifier in root production source, with
// three explicit, narrow carve-outs: Node built-ins (bare or `node:`-
// prefixed), Bun's virtual `bun`/`bun:*` modules, and a named literal
// allowlist of already-known, out-of-scope pre-existing offenders. The
// allowlist is asserted to stay at its authoring size so it cannot silently
// absorb a new violation - growing it is a visible, reviewable diff.
// ---------------------------------------------------------------------------

// Node's built-in module names in their bare (non-`node:`-prefixed) form.
// `packageNameFromSpecifier` already returns null for the `node:`-prefixed
// form, so only the legacy bare form needs an explicit carve-out here.
const NODE_BUILTIN_MODULE_NAMES = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/** True for a Node built-in used without its `node:` prefix, or for Bun's virtual `bun` / `bun:*` runtime modules (e.g. `bun:sqlite`) - neither is a real npm package that could ever be declared in package.json. */
function isNodeOrBunBuiltin(pkg: string): boolean {
  return NODE_BUILTIN_MODULE_NAMES.has(pkg) || pkg === "bun" || pkg.startsWith("bun:");
}

describe("isNodeOrBunBuiltin helper correctness", () => {
  test("recognizes bare Node built-ins", () => {
    expect(isNodeOrBunBuiltin("crypto")).toBe(true);
    expect(isNodeOrBunBuiltin("fs")).toBe(true);
    expect(isNodeOrBunBuiltin("path")).toBe(true);
  });

  test("recognizes Bun's virtual 'bun' module and its 'bun:*' submodules", () => {
    expect(isNodeOrBunBuiltin("bun")).toBe(true);
    expect(isNodeOrBunBuiltin("bun:sqlite")).toBe(true);
    expect(isNodeOrBunBuiltin("bun:test")).toBe(true);
  });

  test("does not flag a real npm package, including one that merely starts with 'bun'", () => {
    expect(isNodeOrBunBuiltin("domhandler")).toBe(false);
    expect(isNodeOrBunBuiltin("bunyan")).toBe(false); // must not false-positive on a startsWith("bun") substring match
  });
});

// Named, literal allowlist of pre-existing bare imports of packages that are
// transitively resolved but absent from the root manifest, established by
// the same full-repo sweep this test performs (see the revision report for
// the exact command). Each entry must document why it is not this slice's
// concern. This is deliberately a flat list of exact package names, never a
// pattern - adding to it is a visible, reviewable act, and the size
// assertion below stops it from silently growing to swallow a new,
// in-scope violation.
const PRE_EXISTING_UNDECLARED_IMPORT_ALLOWLIST = [
  // node/imap-watch.utility.ts imports `libmime` as a value (not type-only);
  // it resolves transitively via mailparser's dependency graph, exactly
  // parallel to domhandler/cheerio. Out of scope for this slice, which owns
  // only the `domhandler` finding named in the requirements brief.
  "libmime",
];

describe("the pre-existing undeclared-import allowlist stays at its authoring size (cannot silently absorb a new violation)", () => {
  test("the allowlist contains exactly the one known pre-existing offender, no more", () => {
    expect(PRE_EXISTING_UNDECLARED_IMPORT_ALLOWLIST).toEqual(["libmime"]);
  });
});

describe("requirement 3 (RED until domhandler is declared): no root production source file imports ANY undeclared package (general sweep, not just domhandler)", () => {
  const declaredRootPackages = new Set([
    ...Object.keys(rootPackageJson.dependencies ?? {}),
    ...Object.keys(rootPackageJson.devDependencies ?? {}),
  ]);

  test("every bare import/require in root production source resolves to a package declared in root package.json, a Node/Bun builtin, or the named pre-existing allowlist (this must not be satisfiable by declaring it in frontend/package.json instead)", () => {
    const violations: string[] = [];
    for (const file of rootProductionSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractBareImportSpecifiers(source)) {
        const pkg = packageNameFromSpecifier(specifier);
        if (!pkg) continue;
        if (isNodeOrBunBuiltin(pkg)) continue;
        if (PRE_EXISTING_UNDECLARED_IMPORT_ALLOWLIST.includes(pkg)) continue;
        if (!declaredRootPackages.has(pkg)) {
          violations.push(`${file.replace(REPO_ROOT, "")}: imports undeclared package '${pkg}' (via '${specifier}')`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("sanity: the general sweep never flags anything beyond the known 'domhandler' surface (proves the carve-outs are narrow, not a blanket exemption) - holds both before and after domhandler is declared", () => {
    const violations: string[] = [];
    for (const file of rootProductionSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractBareImportSpecifiers(source)) {
        const pkg = packageNameFromSpecifier(specifier);
        if (!pkg) continue;
        if (isNodeOrBunBuiltin(pkg)) continue;
        if (PRE_EXISTING_UNDECLARED_IMPORT_ALLOWLIST.includes(pkg)) continue;
        if (!declaredRootPackages.has(pkg)) violations.push(pkg);
      }
    }
    // A stable invariant rather than a transient snapshot: whatever the
    // violation set is right now (empty once domhandler is declared, or
    // exactly {"domhandler"} before that), it must never contain anything
    // outside that one known package - if it did, a carve-out above would
    // be swallowing a real, unrelated violation.
    for (const pkg of violations) {
      expect(pkg, `unexpected undeclared package outside the known domhandler surface: '${pkg}'`).toBe("domhandler");
    }
  });
});

describe("requirement 3 (RED until domhandler is declared): the real fallow oracle agrees - zero unlisted-dependency findings", () => {
  test(
    "dead-code analysis under the committed config reports no unlisted dependencies",
    () => {
      const report = runDeadCode();
      const unlistedNames = (report.unlisted_dependencies ?? []).map((d) => d.package_name);
      expect(unlistedNames, `unlisted dependencies: ${JSON.stringify(unlistedNames)}`).toEqual([]);
    },
    EXEC_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// requirement 2: the nine provably-dead starter-config adapters are removed.
// ---------------------------------------------------------------------------

const DEAD_STARTER_ADAPTER_NAMES = [
  "calendar",
  "change-detection",
  "existing-feed",
  "graphql",
  "manual",
  "rest-api",
  "service-connector",
  "sitemap",
  "web-scraping",
];

const DEAD_STARTER_ADAPTER_PATHS = DEAD_STARTER_ADAPTER_NAMES.map(
  (name) => `utilities/source-assistant/starter-configs/${name}.adapter.ts`,
);

describe("sanity: buildStarterConfig's index.ts implements every route inline and imports none of the nine adapters (establishes 'genuinely dead', not merely 'currently unused')", () => {
  test("starter-configs/index.ts does not import any *.adapter module", () => {
    const source = readFileSync(join(REPO_ROOT, "utilities", "source-assistant", "starter-configs", "index.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*\.adapter["']/);
  });

  test("no other production source file (outside tests/) references a starter-configs adapter module by path", () => {
    const violations: string[] = [];
    for (const file of rootProductionSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const name of DEAD_STARTER_ADAPTER_NAMES) {
        if (source.includes(`starter-configs/${name}.adapter`)) {
          violations.push(`${file.replace(REPO_ROOT, "")} references starter-configs/${name}.adapter`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("requirement 2 (RED until the adapters are deleted): all nine dead starter-config adapters are removed from disk", () => {
  for (const relPath of DEAD_STARTER_ADAPTER_PATHS) {
    test(`${relPath} no longer exists`, () => {
      expect(existsSync(join(REPO_ROOT, relPath)), `${relPath} must be deleted, not merely suppressed or ignored`).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Amendment 1.C: the original eleven-file `ROADMAP_PENDING_PATHS` list was
// over-broad - it protected genuinely dead files and made green unreachable
// without exceptions. A path may stay protected only with a cited reason (a
// V2 finding id, or an owning packet whose scope will consume it); every
// other currently-unused file is dead code and must be deleted with the
// same "prove nothing imports it" standard already applied to the nine
// starter-config adapters.
//
// The lead's classification is verified below rather than trusted: every
// one of the six "must delete" files was independently confirmed
// unreferenced anywhere in the repository (production or test code) via a
// repo-wide search before this list was written.
// ---------------------------------------------------------------------------

const PROTECTED_CITED_PATHS = [
  "frontend/src/components/builder/KVEditor.tsx", // V2-02
  "frontend/src/components/catalog/CatalogMetadataForm.tsx", // Packet 8
  "frontend/src/components/catalog/CatalogSanitizedYamlPreview.tsx", // Packet 8
  "frontend/src/components/catalog/CatalogSubmissionDialog.tsx", // Packet 8
  "frontend/src/components/forms/CookiesManager.tsx", // V2-16
];

describe("protected-cited unused components still exist (Amendment 1.C: deleting a cited roadmap-pending file to close a finding is a failure, not a fix)", () => {
  for (const relPath of PROTECTED_CITED_PATHS) {
    test(`${relPath} still exists`, () => {
      expect(
        existsSync(join(REPO_ROOT, relPath)),
        `${relPath} must not be deleted; it is a cited roadmap-pending V2/packet finding, not dead code`,
      ).toBe(true);
    });
  }
});

describe("statSync sanity: every protected-cited path is a file, not a directory (guards against a same-named directory substituting for the real component)", () => {
  for (const relPath of PROTECTED_CITED_PATHS) {
    test(`${relPath} is a regular file`, () => {
      const full = join(REPO_ROOT, relPath);
      if (!existsSync(full)) return; // already reported by the describe block above
      expect(statSync(full).isFile()).toBe(true);
    });
  }
});

// A basename/path-fragment distinctive enough to appear only in a real
// `from "..."` import of that module, paired with the module's own path so
// the "nothing imports it" scan below is precise per file (mirrors the
// starter-config adapter check's `starter-configs/${name}.adapter`
// substring technique).
const MUST_DELETE_MODULES: Array<{ path: string; importMarker: string }> = [
  { path: "frontend/src/components/builder/SectionHeader.tsx", importMarker: "SectionHeader" },
  { path: "frontend/src/components/builder/SectionPager.tsx", importMarker: "SectionPager" },
  { path: "frontend/src/components/ui/accordion.tsx", importMarker: "components/ui/accordion" },
  { path: "frontend/src/pages/health/SettingsTab.tsx", importMarker: "SettingsTab" },
  { path: "lib/analytics/types.ts", importMarker: "analytics/types" },
  { path: "models/imapconfig.model.ts", importMarker: "imapconfig.model" },
];

const FRONTEND_SRC_EXCLUDED_DIR_NAMES = new Set(["node_modules"]);

function frontendSrcSourceFiles(): string[] {
  const dir = join(REPO_ROOT, "frontend", "src");
  const results: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (FRONTEND_SRC_EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        results.push(join(current, entry.name));
      }
    }
  }
  walk(dir);
  return results;
}

/** Every root-production + frontend/src production source file - the full first-party surface a "nothing imports this file" check must cover. */
function allProductionSourceFiles(): string[] {
  return [...rootProductionSourceFiles(), ...frontendSrcSourceFiles()];
}

describe("sanity: none of the six 'must delete' files are imported anywhere in the repository outside their own declaration/definition (verifies, rather than trusts, the lead's classification)", () => {
  // Lead review round 4, item 1: this must NOT assert that the six
  // MUST_DELETE_MODULES paths themselves are discoverable - the whole point
  // of this describe block's sibling ("Amendment 1.C") is that they get
  // deleted, so a sanity check requiring their continued existence would
  // make the suite permanently red once that deletion lands. The scan
  // mechanism is validated instead against files that are never expected to
  // be deleted by this or any other slice.
  test("allProductionSourceFiles() discovers known-stable files that will never be deleted (sanity check for the scan mechanism itself, independent of the six files it is used to check)", () => {
    const normalized = allProductionSourceFiles().map((f) => f.replaceAll("\\", "/"));
    expect(normalized.some((f) => f.endsWith("/utilities/rss-builder.utility.ts")), "expected to discover utilities/rss-builder.utility.ts").toBe(
      true,
    );
    expect(normalized.some((f) => f.endsWith("/index.ts")), "expected to discover index.ts").toBe(true);
  });

  for (const { path, importMarker } of MUST_DELETE_MODULES) {
    test(`no file other than '${path}' itself references it by import path (marker: '${importMarker}')`, () => {
      const violations: string[] = [];
      const selfAbs = join(REPO_ROOT, path).replaceAll("\\", "/");
      for (const file of allProductionSourceFiles()) {
        const normalizedFile = file.replaceAll("\\", "/");
        if (normalizedFile === selfAbs) continue; // the file's own definition/self-reference doesn't count
        const source = readFileSync(file, "utf8");
        if (source.includes(importMarker)) {
          violations.push(`${file.replace(REPO_ROOT, "")} references '${importMarker}'`);
        }
      }
      expect(violations, violations.join("\n")).toEqual([]);
    });
  }
});

describe("Amendment 1.C (RED until deleted): the six unreferenced, roadmap-uncited files are removed from disk", () => {
  for (const { path } of MUST_DELETE_MODULES) {
    test(`${path} no longer exists`, () => {
      expect(existsSync(join(REPO_ROOT, path)), `${path} must be deleted: it is unreferenced and has no cited packet/V2 owner`).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Amendment 1.D: fix the worst existing findings rather than recording them.
//
// D1 (oracle half - the pure-function behavior lock over the affected
// exports lives in tests/fallow-circular-dependency-behavior.test.ts, kept
// separate because it needs no fallow spawn at all): the
// data-handler.utility.ts <-> rss-builder.utility.ts circular dependency
// fallow flags as an initialization/tree-shaking risk must be gone.
//
// D2: the unused exports fallow reports in first-party utilities/ must be
// resolved - either removed/de-exported (provably safe, since nothing
// references them at all) or genuinely wired into a real caller (which
// removes them from "unused" without this suite needing to predict which
// specific functions a future caller will need - the export simply stops
// appearing in this finding). This is deliberately scoped to utilities/
// only, matching the brief's "unused exports fallow reports in first-party
// utilities" - not routes/, models/, or frontend/src/, which belong to
// other packets' surfaces.
//
// Lead review round 4, item 2: a blanket "zero unused exports" requirement
// would force deleting exports that implement genuine, roadmap-cited,
// currently-disconnected V2 functionality (V2-07's CSS-target builder and
// relative-link inference, V2-14/V2-16's cookie handling, V2-03/V2-04's
// webhook new-items filtering) - the exact "close the finding by causing a
// regression against locked product decision 3" failure mode this slice
// already guards against for whole files. This mirrors PROTECTED_CITED_PATHS
// at the export level: CITED_UNUSED_EXPORTS names exactly the exports
// permitted to remain in the finding, each with a verifiable V2/packet
// citation - not four names taken on trust. Before writing this list, every
// one of the 22 currently-unused exports was checked (in this session, via
// a repo-wide search, both for genuinely dead functions worth immediate
// deletion, and the more subtle case of exports called by nothing outside
// their own file but ARE still called from an already-exported function
// within it, e.g. `applySitemapFilters`/`sortSitemapEntries`,
// `resolveServiceConnectorAuth`, `ensureServiceConnectorStateTable`,
// `initializeWorker`, `stripHtml`/`titleCase`/`appendUrl`,
// `buildCalendarItems`, `getChromeExtensionPaths`, `getCatalogEntry`,
// `ensureFeedHistoryDir`, `processLinksAbsolute`, `loadFilesystemState`,
// `getByPath`/`getArrayByPath` - these are all genuinely live code, just
// over-exported, and resolve safely by de-export alone with zero roadmap
// risk, so none of them need a citation). Only four exports had ZERO
// references anywhere in the repository (not even from their own file) AND
// a specific, textually-matching V2 finding - those four, and only those
// four, are cited below.
// ---------------------------------------------------------------------------

describe("Amendment 1.D1 (RED until untangled): the data-handler.utility.ts <-> rss-builder.utility.ts circular dependency is gone", () => {
  test(
    "the real fallow oracle reports zero circular dependencies involving these two files",
    () => {
      const report = runDeadCode();
      const involvingBoth = (report.circular_dependencies ?? []).filter(
        (c) => c.files.includes("utilities/data-handler.utility.ts") && c.files.includes("utilities/rss-builder.utility.ts"),
      );
      expect(involvingBoth, JSON.stringify(involvingBoth)).toEqual([]);
    },
    EXEC_TIMEOUT_MS,
  );
});

interface CitedUnusedExport {
  path: string;
  exportName: string;
  owner: string;
}

const CITED_UNUSED_EXPORTS: CitedUnusedExport[] = [
  {
    path: "utilities/css-target-builder.utility.ts",
    exportName: "buildCSSTarget",
    owner: "V2-07",
  },
  {
    path: "utilities/data-handler.utility.ts",
    exportName: "processLinks",
    owner: "V2-07",
  },
  {
    path: "utilities/data-handler.utility.ts",
    exportName: "parseCookiesForPlaywright",
    owner: "V2-14/V2-16",
  },
  {
    path: "utilities/webhook.utility.ts",
    exportName: "getNewItemsFromRSS",
    owner: "V2-04",
  },
];

function citedExportKey(path: string, exportName: string): string {
  return `${path}::${exportName}`;
}

describe("Amendment 1.D2 (RED until resolved): unused exports fallow reports under utilities/ are all resolved (removed/de-exported/wired-in) or cited", () => {
  test(
    "the real fallow oracle reports zero unused exports under utilities/ outside the cited list",
    () => {
      const report = runDeadCode();
      const citedKeys = new Set(CITED_UNUSED_EXPORTS.map((c) => citedExportKey(c.path, c.exportName)));
      const remaining = (report.unused_exports ?? [])
        .filter((e) => e.path.startsWith("utilities/"))
        .filter((e) => !citedKeys.has(citedExportKey(e.path, e.export_name ?? "")))
        .map((e) => `${e.path}: ${e.export_name ?? "?"}`);
      expect(remaining, remaining.join("\n")).toEqual([]);
    },
    EXEC_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Verifies, rather than trusts, each CITED_UNUSED_EXPORTS entry: every cited
// export must (a) actually exist as a real export in its named file, (b)
// have zero references from any other production file (if something else
// already imported it, it would not genuinely be "unused" and citing it
// would be nonsensical), and (c) carry a real V2-<n> or Packet-<n>-shaped
// owner, not free text - the same structural bar CITED_UNUSED_EXPORTS'
// sibling PROTECTED_CITED_PATHS is held to.
// ---------------------------------------------------------------------------

/** Strips line comments and block comments before a real-code search, so a note like "parseCookiesForPlaywright might be simplified or removed" (found verbatim in workers/feed-updater.worker.ts while verifying this citation) does not count as a real reference - a comment is not a runtime dependency. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** True when `exportName` is referenced as real code - a named import specifier or a call expression - rather than merely appearing in a comment. */
function referencesExportAsRealCode(source: string, exportName: string): boolean {
  const stripped = stripComments(source);
  const importPattern = new RegExp(`\\bimport\\s*(?:type\\s*)?\\{[^}]*\\b${exportName}\\b[^}]*\\}\\s*from`);
  const callPattern = new RegExp(`\\b${exportName}\\s*\\(`);
  return importPattern.test(stripped) || callPattern.test(stripped);
}

describe("stripComments / referencesExportAsRealCode helper correctness", () => {
  test("stripComments removes a full-line '//' comment", () => {
    expect(stripComments('// import { foo } from "bar";\nconst x = 1;')).not.toContain("import { foo }");
  });

  test("stripComments removes a block comment", () => {
    expect(stripComments("/* import { foo } from 'bar'; */\nconst x = 1;")).not.toContain("import { foo }");
  });

  test("referencesExportAsRealCode ignores a commented-out import (the exact shape found in workers/feed-updater.worker.ts)", () => {
    const source = [
      "// parseCookiesForPlaywright might be simplified or removed if cookies are directly structured correctly",
      '// import { parseCookiesForPlaywright } from "../utilities/data-handler.utility"',
    ].join("\n");
    expect(referencesExportAsRealCode(source, "parseCookiesForPlaywright")).toBe(false);
  });

  test("referencesExportAsRealCode detects a real named import", () => {
    expect(referencesExportAsRealCode('import { foo } from "./bar";', "foo")).toBe(true);
  });

  test("referencesExportAsRealCode detects a real call expression", () => {
    expect(referencesExportAsRealCode("const x = foo(1, 2);", "foo")).toBe(true);
  });

  test("referencesExportAsRealCode does not flag an unrelated name that merely contains the target as a substring", () => {
    expect(referencesExportAsRealCode('import { fooBar } from "./bar";', "foo")).toBe(false);
  });
});

describe("sanity: every CITED_UNUSED_EXPORTS entry is a real, currently-unreferenced-anywhere export with a well-formed owner (verifies, rather than trusts, the citation)", () => {
  test("every cited owner matches 'V2-<n>' or 'V2-<n>/V2-<n>' or 'Packet <n>', not free text", () => {
    for (const { exportName, owner } of CITED_UNUSED_EXPORTS) {
      expect(
        /^(V2-\d+(\/V2-\d+)*|Packet\s+\d+)$/.test(owner),
        `${exportName}'s owner = '${owner}' must be a V2 finding id or a packet, not free text`,
      ).toBe(true);
    }
  });

  for (const { path, exportName } of CITED_UNUSED_EXPORTS) {
    test(`${path} actually exports a function or const named '${exportName}'`, () => {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      const pattern = new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const)\\s+${exportName}\\b`);
      expect(pattern.test(source), `expected 'export function/const ${exportName}' in ${path}`).toBe(true);
    });

    test(`no file other than '${path}' references '${exportName}' as real code (proves it is genuinely disconnected, not merely flagged)`, () => {
      const selfAbs = join(REPO_ROOT, path).replaceAll("\\", "/");
      const violations: string[] = [];
      for (const file of allProductionSourceFiles()) {
        const normalizedFile = file.replaceAll("\\", "/");
        if (normalizedFile === selfAbs) continue;
        const source = readFileSync(file, "utf8");
        if (referencesExportAsRealCode(source, exportName)) {
          violations.push(file.replace(REPO_ROOT, ""));
        }
      }
      expect(violations, violations.join("\n")).toEqual([]);
    });
  }
});
