import { describe, test, expect } from "bun:test";
import { readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Specifies the root/frontend/E2E TypeScript configuration contract from the
// `p1-static-quality-contract` requirements brief (roadmap Packet 1, C3).
//
// TypeScript itself is only installed locally under `frontend/node_modules`
// (no root devDependency is pinned yet). This suite borrows that one local
// install - a legitimate, network-free test-infrastructure choice - to run
// the TypeScript Compiler API directly against every config this slice
// owns. That gives a precise, deterministic, offline equivalent of
// `tsc --showConfig` (config resolution with zero errors) plus a real
// global-type-resolution probe (does `typeof Bun` / the frontend fixture
// types actually resolve), which is far more reliable than parsing text
// output from a spawned `tsc` process.
//
// Once the root `typescript` devDependency is pinned to the exact same
// version as frontend's (see tests/static-quality-scripts.test.ts), the two
// installs are required to be identical, so using frontend's copy to probe
// the root config is not testing a different tool than the one root's own
// `typecheck:root` script will eventually use.
//
// Coverage assertions below discover the applicable production `.ts`/`.tsx`
// files from disk at test time (never a hard-coded sample list), so a
// config that covers only a few representative files - or omits a
// newly-added file - fails.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
// Dynamic require of the one locally installed TypeScript copy (test infrastructure, not application code).
const ts = require(join(FRONTEND_DIR, "node_modules/typescript")) as typeof import("typescript");

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

function readParsedConfig(configPath: string, basePath: string) {
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(readResult.error, `failed to read ${configPath}`).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, basePath);
  return parsed;
}

function diagnosticMessages(diagnostics: readonly import("typescript").Diagnostic[]): string[] {
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

/**
 * Builds a real ts.Program from a resolved config plus one extra synthetic
 * probe file, and returns the probe file's own diagnostics. Used to prove
 * global-type resolution (e.g. `typeof Bun`) without depending on any
 * particular typeRoots/types shape - only on the observable outcome. The
 * temp directory it creates is always removed, success or failure, so
 * repeated local/CI runs do not accumulate stale probe files.
 */
function probeGlobalResolution(parsed: ReturnType<typeof readParsedConfig>, probeSource: string): string[] {
  const probeDir = mkdtempSync(join(tmpdir(), "mkfd-tsc-probe-"));
  try {
    const probeFile = join(probeDir, "probe.ts");
    writeFileSync(probeFile, probeSource, "utf8");
    const program = ts.createProgram({ rootNames: [...parsed.fileNames, probeFile], options: parsed.options });
    const sourceFile = program.getSourceFile(probeFile);
    return diagnosticMessages(ts.getPreEmitDiagnostics(program, sourceFile));
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

/** Recursively lists files under `dir` matching `extensionPattern`, skipping any directory named in `excludeDirNames` at any depth. */
function discoverFilesRecursive(dir: string, extensionPattern: RegExp, excludeDirNames: Set<string>): string[] {
  const results: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (excludeDirNames.has(entry.name)) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile() && extensionPattern.test(entry.name)) {
        results.push(normalize(join(current, entry.name)));
      }
    }
  }
  walk(dir);
  return results;
}

const PROBE_TIMEOUT_MS = 60_000;

describe("root tsconfig.json is a configuration-only probe success (requirement 8)", () => {
  test("parses with zero config errors (tsc --showConfig equivalent)", () => {
    const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
    expect(diagnosticMessages(parsed.errors)).toEqual([]);
  });
});

describe("root TypeScript uses a supported ESM/Bun-compatible resolution mode (requirement 6)", () => {
  test("moduleResolution is not the removed Node10/Classic legacy mode", () => {
    const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
    expect(parsed.options.moduleResolution).not.toBe(ts.ModuleResolutionKind.Node10);
    expect(parsed.options.moduleResolution).not.toBe(ts.ModuleResolutionKind.Classic);
  });

  test(
    "resolves the canonical bun global type package without a narrowed typeRoots trap",
    () => {
      const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
      const diagnostics = probeGlobalResolution(parsed, "declare const __mkfd_probe__: typeof Bun;\nexport {};\n");
      const relevant = diagnostics.filter((d) => /\bBun\b|bun-types|type definition/i.test(d));
      expect(relevant, JSON.stringify(diagnostics)).toEqual([]);
    },
    PROBE_TIMEOUT_MS,
  );
});

describe("root TypeScript does not compile frontend files under the root config (requirement 6)", () => {
  test("resolved fileNames contain no path under frontend/", () => {
    const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
    const frontendFiles = parsed.fileNames.map(normalize).filter((f) => f.includes("/frontend/"));
    expect(frontendFiles).toEqual([]);
  });

  test("resolved fileNames still contain root application source", () => {
    const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
    const normalized = parsed.fileNames.map(normalize);
    expect(normalized.some((f) => f.endsWith("/index.ts"))).toBe(true);
  });
});

describe("root tsconfig does not bypass strictness (edge case)", () => {
  test("strict mode is enabled (not omitted, not false)", () => {
    const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
    expect(parsed.options.strict).toBe(true);
  });

  test("noCheck is not enabled and the config still resolves node_modules types normally", () => {
    const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
    expect((parsed.options as { noCheck?: boolean }).noCheck).not.toBe(true);
  });
});

describe("root tsconfig covers all discovered root production source, not a representative sample (requirement 6)", () => {
  // "tests" and "scripts" are dev/CI tooling run directly via bun (bun
  // typechecks nothing to execute them) rather than shipped application
  // source, and are explicitly allowed to sit outside the root production
  // project per the brief ("Generated output, dependencies, tests, and
  // frontend remain excluded from the root project as specified"). Every
  // other top-level directory is ordinary application source and must be
  // covered - discovered from disk, not hard-coded, so a newly added
  // application file cannot be silently skipped.
  const ROOT_EXCLUDED_DIR_NAMES = new Set([
    "node_modules",
    "frontend",
    "tests",
    "scripts",
    ".git",
    ".tdd-state",
    ".github",
    "public",
    "configs",
    "feed-history",
    "feed-state",
    "data",
    "drizzle",
    "community-catalog",
    "docs",
  ]);

  test("every discovered root production .ts file is present in the resolved fileNames", () => {
    const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
    const resolvedSet = new Set(parsed.fileNames.map(normalize));
    const discovered = discoverFilesRecursive(REPO_ROOT, /\.tsx?$/, ROOT_EXCLUDED_DIR_NAMES);
    expect(discovered.length, "expected to discover at least one root production .ts file").toBeGreaterThan(0);
    const missing = discovered.filter((f) => !resolvedSet.has(f));
    expect(missing, `root tsconfig.json fileNames is missing:\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("frontend application tsconfig.json remains strict and checks all of src (requirement 7)", () => {
  test("parses with zero config errors", () => {
    const parsed = readParsedConfig(join(FRONTEND_DIR, "tsconfig.json"), FRONTEND_DIR);
    expect(diagnosticMessages(parsed.errors)).toEqual([]);
  });

  test("strict mode is enabled", () => {
    const parsed = readParsedConfig(join(FRONTEND_DIR, "tsconfig.json"), FRONTEND_DIR);
    expect(parsed.options.strict).toBe(true);
    expect((parsed.options as { noCheck?: boolean }).noCheck).not.toBe(true);
  });

  test("every discovered frontend/src .ts/.tsx file is present in the resolved fileNames", () => {
    const parsed = readParsedConfig(join(FRONTEND_DIR, "tsconfig.json"), FRONTEND_DIR);
    const resolvedSet = new Set(parsed.fileNames.map(normalize));
    const discovered = discoverFilesRecursive(join(FRONTEND_DIR, "src"), /\.tsx?$/, new Set(["node_modules"]));
    expect(discovered.length, "expected to discover at least one frontend/src file").toBeGreaterThan(0);
    const missing = discovered.filter((f) => !resolvedSet.has(f));
    expect(missing, `frontend/tsconfig.json fileNames is missing:\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("a frontend TypeScript config covers the Playwright E2E surface, uniquely (requirement 7 + 8)", () => {
  function discoverFrontendTsconfigPaths(): string[] {
    return readdirSync(FRONTEND_DIR)
      .filter((name) => /^tsconfig[\w.-]*\.json$/.test(name))
      .map((name) => join(FRONTEND_DIR, name));
  }

  function discoverE2EFiles(): string[] {
    return discoverFilesRecursive(join(FRONTEND_DIR, "e2e"), /\.tsx?$/, new Set(["node_modules"])).concat(
      normalize(join(FRONTEND_DIR, "playwright.config.ts")),
    );
  }

  function coversPlaywrightConfig(configPath: string): boolean {
    const parsed = readParsedConfig(configPath, FRONTEND_DIR);
    return parsed.fileNames.map(normalize).some((f) => f.endsWith("/playwright.config.ts"));
  }

  function coveringE2EConfigs(): string[] {
    return discoverFrontendTsconfigPaths().filter(coversPlaywrightConfig);
  }

  test("at least one frontend tsconfig*.json resolves to include every discovered e2e/*.ts file plus playwright.config.ts", () => {
    const e2eFiles = discoverE2EFiles();
    expect(e2eFiles.length, "expected to discover at least playwright.config.ts and one e2e file").toBeGreaterThan(1);

    const union = new Set<string>();
    for (const configPath of discoverFrontendTsconfigPaths()) {
      const parsed = readParsedConfig(configPath, FRONTEND_DIR);
      for (const file of parsed.fileNames) union.add(normalize(file));
    }
    const missing = e2eFiles.filter((f) => !union.has(f));
    expect(missing, `no frontend tsconfig*.json (union) resolves these E2E files:\n${missing.join("\n")}`).toEqual([]);
  });

  test("exactly one discovered frontend tsconfig covers playwright.config.ts (no ambiguous/duplicate E2E project)", () => {
    const covering = coveringE2EConfigs();
    expect(
      covering.length,
      `expected exactly one covering E2E tsconfig, found ${covering.length}: ${covering.join(", ")}`,
    ).toBe(1);
  });

  test("every discovered E2E file (playwright.config.ts + each e2e/*.ts) is owned by exactly one frontend tsconfig, not merely covered by the union", () => {
    // Closes the case where a dedicated E2E config owns everything but a
    // second, unrelated tsconfig (e.g. the main frontend/tsconfig.json)
    // *also* independently includes some/all of frontend/e2e/**/*.ts: the
    // union- and single-covering-config-based checks above would both still
    // pass even though every such spec is compiled by two projects at once.
    const e2eFiles = discoverE2EFiles();
    const parsedConfigs = discoverFrontendTsconfigPaths().map((configPath) => ({
      configPath,
      fileNames: new Set(readParsedConfig(configPath, FRONTEND_DIR).fileNames.map(normalize)),
    }));

    const unowned: string[] = [];
    const multiOwned: string[] = [];
    for (const file of e2eFiles) {
      const owners = parsedConfigs.filter((c) => c.fileNames.has(file)).map((c) => c.configPath);
      if (owners.length === 0) unowned.push(file);
      else if (owners.length > 1) multiOwned.push(`${file} -> [${owners.join(", ")}]`);
    }
    expect(unowned, `E2E files with no owning frontend tsconfig:\n${unowned.join("\n")}`).toEqual([]);
    expect(
      multiOwned,
      `E2E files compiled by more than one frontend tsconfig (ambiguous double ownership):\n${multiOwned.join("\n")}`,
    ).toEqual([]);
  });

  test("the single covering E2E config actually includes every discovered e2e/*.ts file, not just playwright.config.ts", () => {
    const covering = coveringE2EConfigs();
    expect(covering.length, "expected exactly one covering E2E tsconfig - see previous test").toBe(1);
    const [configPath] = covering;
    const parsed = readParsedConfig(configPath, FRONTEND_DIR);
    const resolvedSet = new Set(parsed.fileNames.map(normalize));
    const missing = discoverE2EFiles().filter((f) => !resolvedSet.has(f));
    expect(missing, `${configPath} fileNames is missing:\n${missing.join("\n")}`).toEqual([]);
  });

  test("the covering E2E config parses with zero config errors (tsc --showConfig equivalent, requirement 8)", () => {
    const covering = coveringE2EConfigs();
    expect(covering.length, "expected exactly one covering E2E tsconfig - see previous test").toBe(1);
    const parsed = readParsedConfig(covering[0], FRONTEND_DIR);
    expect(diagnosticMessages(parsed.errors)).toEqual([]);
  });

  test("the covering E2E config does not disable strict mode or use noCheck to hide fixture/spec errors", () => {
    const covering = coveringE2EConfigs();
    expect(covering.length, "expected exactly one covering E2E tsconfig - see previous test").toBe(1);
    const parsed = readParsedConfig(covering[0], FRONTEND_DIR);
    expect(parsed.options.strict).toBe(true);
    expect((parsed.options as { noCheck?: boolean }).noCheck).not.toBe(true);
  });

  test(
    "the covering E2E config typechecks Playwright config/fixtures/specs with zero diagnostics, including a correctly-typed 'authenticatedPage' fixture",
    () => {
      const covering = coveringE2EConfigs();
      expect(covering.length, "expected exactly one covering E2E tsconfig - see previous test").toBe(1);

      const parsed = readParsedConfig(covering[0], FRONTEND_DIR);
      const e2eFileNames = parsed.fileNames.filter((f) => {
        const n = normalize(f);
        return n.includes("/e2e/") || n.endsWith("/playwright.config.ts");
      });
      expect(e2eFileNames.length).toBeGreaterThan(0);

      const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
      const allDiagnostics = e2eFileNames.flatMap((fileName) => {
        const sourceFile = program.getSourceFile(fileName);
        return diagnosticMessages(ts.getPreEmitDiagnostics(program, sourceFile));
      });

      const fixtureTypingDiagnostics = allDiagnostics.filter((d) => /authenticatedPage/i.test(d));
      expect(
        fixtureTypingDiagnostics,
        "the custom authenticatedPage fixture must be typed on the Playwright TestArgs, not merely present at runtime",
      ).toEqual([]);
      expect(allDiagnostics, JSON.stringify(allDiagnostics)).toEqual([]);
    },
    PROBE_TIMEOUT_MS,
  );
});
