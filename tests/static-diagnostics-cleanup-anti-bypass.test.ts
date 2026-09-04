import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the "no fake green" anti-bypass contract from the
// `p1-static-diagnostics-cleanup` requirements brief. `bun run lint` and
// `bun run typecheck*` reaching exit 0 (see
// `tests/static-diagnostics-cleanup-architecture.test.ts`) is necessary but
// not sufficient: this suite pins down the specific escapes the brief
// forbids (rule/group downgrades, per-file exclusions, CSS-linter
// disabling, unsafe-escape-hatch growth) so a config or source edit that
// reaches "0 errors" by hiding violations instead of fixing them still
// fails here.
//
// Most tests in this file currently PASS: no bypass exists yet, because no
// fix has been attempted. They exist to fail the moment a *bypass* fix is
// attempted, not to fail against the current (honestly red) baseline - that
// RED proof lives in the architecture suite instead.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const EXEC_TIMEOUT_MS = 30_000;

// --------------------------- real pinned-binary oracle ---------------------------

function localBiomeBinPath(): string | null {
  const dotBin = join(REPO_ROOT, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? [join(dotBin, "biome.exe"), join(dotBin, "biome.CMD"), join(dotBin, "biome.cmd")]
      : [join(dotBin, "biome")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

interface PinnedBiomeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

// `isPathIgnoredByPinnedBiome` and `checkedFileCount` both run the exact
// same command for a given (path, config) pair, and the "known-erroring
// files" loop below calls both for each of 16 files - a real duplicate
// spawn per file with no additional signal. This cache reuses one real
// spawned result per unique argument list while every caller's own
// independent assertion still runs and is still individually attributable.
const pinnedBiomeCache = new Map<string, PinnedBiomeResult>();

function runPinnedBiome(args: string[]): PinnedBiomeResult {
  const cacheKey = JSON.stringify(args);
  const cached = pinnedBiomeCache.get(cacheKey);
  if (cached) return cached;
  const bin = localBiomeBinPath();
  expect(bin, "no local node_modules/.bin/biome(.exe) found").not.toBeNull();
  const proc = Bun.spawnSync({ cmd: [bin as string, ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  const result: PinnedBiomeResult = {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    combined: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
  };
  pinnedBiomeCache.set(cacheKey, result);
  return result;
}

function isPathIgnoredByPinnedBiome(pathArg: string, configPath: string): boolean {
  const { stderr } = runPinnedBiome(["lint", pathArg, "--config-path", configPath]);
  return /provided but ignored/i.test(stderr);
}

function checkedFileCount(pathArg: string, configPath: string): number {
  const { combined } = runPinnedBiome(["lint", pathArg, "--config-path", configPath]);
  const match = combined.match(/Checked (\d+) files? in/);
  return match ? Number(match[1]) : 0;
}

/**
 * Parses Biome's `--verbose` "Files processed:" listing into the real,
 * individual relative file paths it actually walked (not just an aggregate
 * count) - see `tests/static-quality-scripts.test.ts` for the identical
 * technique. This is what lets the coverage check below compare the exact
 * set of files Biome touched against the set discovered independently from
 * disk, rather than trusting a count.
 */
function parseVerboseProcessedFiles(output: string): string[] {
  const section = output.split("Files processed:")[1]?.split("Files fixed:")[0] ?? "";
  return [...section.matchAll(/^\s*-\s+(.+?)\r?$/gm)].map((m) => m[1].trim().replaceAll("\\", "/"));
}

function runVerbosePinnedBiome(pathArg: string, configPath: string): { files: string[]; combined: string } {
  const { combined } = runPinnedBiome(["lint", pathArg, "--config-path", configPath, "--verbose"]);
  return { files: parseVerboseProcessedFiles(combined), combined };
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
        results.push(join(current, entry.name));
      }
    }
  }
  walk(dir);
  return results;
}

// Production source only: root application source (mirroring the root
// tsconfig's owned scope) plus frontend/src. Deliberately excludes
// tests/, scripts/, frontend/e2e/, and all generated/dependency/runtime
// directories - suppression comments in test/tooling code are a different
// concern from suppressions added to silence a real production diagnostic.
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

function normalizeRelPath(absPath: string): string {
  return absPath.replace(REPO_ROOT, "").replaceAll("\\", "/").replace(/^\//, "");
}

// --------------------------- requirement: known-erroring files stay linted ---------------------------

describe("files that currently produce Biome errors remain checked, not newly excluded (anti-bypass)", () => {
  // A concrete, disk-verified sample spanning every directory that currently
  // contributes to the 92-error baseline (frontend components across
  // multiple subfolders, a frontend stylesheet, a raw SVG asset, root
  // node/utilities files including a nested subfolder). A fix that reaches
  // "0 errors" via a new `files.includes` negation (whole-file, whole-folder,
  // or a broad `!frontend/src/**`-style pattern) will make at least one of
  // these newly "provided but ignored" instead of genuinely fixed.
  const knownErroringFiles: Array<{ path: string; configPath: string }> = [
    { path: "frontend/src/index.css", configPath: "biome.json" },
    { path: "frontend/src/assets/graphql.svg", configPath: "biome.json" },
    { path: "frontend/src/assets/sitemap.svg", configPath: "biome.json" },
    { path: "frontend/src/components/builder/TypePickerGrid.tsx", configPath: "biome.json" },
    { path: "frontend/src/components/feeds/FeedDetailDrawer.tsx", configPath: "biome.json" },
    { path: "frontend/src/components/feeds/FeedTypeBadge.tsx", configPath: "biome.json" },
    { path: "frontend/src/components/forms/FeedBuilderForm.tsx", configPath: "biome.json" },
    { path: "frontend/src/components/ui/toast-provider.tsx", configPath: "biome.json" },
    { path: "frontend/src/pages/catalog/CommunityCatalogPage.tsx", configPath: "biome.json" },
    { path: "frontend/src/components/settings/RequestProfilesPanel.tsx", configPath: "biome.json" },
    { path: "node/imap-watch.utility.ts", configPath: "biome.root.json" },
    { path: "utilities/xml-sanitizer.utility.ts", configPath: "biome.root.json" },
    { path: "utilities/rss-builder.utility.ts", configPath: "biome.root.json" },
    { path: "utilities/structured-feed.utility.ts", configPath: "biome.root.json" },
    { path: "utilities/web-scraping-fetcher.utility.ts", configPath: "biome.root.json" },
    { path: "utilities/community-catalog/catalog-sanitizer.utility.ts", configPath: "biome.root.json" },
  ];

  for (const { path, configPath } of knownErroringFiles) {
    test(
      `'${path}' is not ignored and is actually checked under ${configPath}`,
      () => {
        expect(isPathIgnoredByPinnedBiome(path, configPath), `biome lint ${path} --config-path ${configPath}`).toBe(
          false,
        );
        expect(checkedFileCount(path, configPath)).toBeGreaterThan(0);
      },
      EXEC_TIMEOUT_MS,
    );
  }
});

// ---------------------------------------------------------------------------
// The sampled list above is a fast, concrete probe over 16 files known to be
// erroring at authoring time, but a *different*, unsampled erroring file
// (e.g. another feed component not on that list) could still be individually
// negated in `files.includes` while the sample stays green. This describe
// block closes that gap generically: it dynamically discovers the FULL set
// of applicable root/frontend source files from disk (the same universe the
// `lint:root`/`lint:frontend` scripts are supposed to cover), runs the real
// pinned binary with `--verbose` exactly as `tests/static-quality-scripts.test.ts`
// already does to get Biome's own "Files processed:" listing, and asserts
// every discovered file is actually in that processed set. A single new
// negated path - however it is spelled - makes at least one discovered file
// vanish from the processed set and fails here, without needing to guess
// which file a future bypass might target. It also implicitly preserves the
// approved negated generated/reference/runtime paths from the preceding
// slice: those directories are never part of the "discovered" universe in
// the first place (see `ROOT_EXCLUDED_DIR_NAMES` / the frontend generated-dir
// exclusions below), so this check does not require them to be processed.
// ---------------------------------------------------------------------------

describe("the full discovered root/frontend source universe is processed by the real binary, not just the sampled files (anti-bypass)", () => {
  const rootDiscovered = discoverFilesRecursive(REPO_ROOT, /\.tsx?$/, ROOT_EXCLUDED_DIR_NAMES).map(normalizeRelPath);

  // Mirrors the approved generated/dependency/runtime exclusions from the
  // preceding `p1-static-quality-contract` slice (see
  // tests/static-quality-biome-config.test.ts): these stay legitimately
  // excluded and are therefore never expected in the processed set.
  const FRONTEND_EXCLUDED_DIR_NAMES = new Set(["node_modules", "playwright-report", "test-results", "dist"]);
  const frontendDiscovered = discoverFilesRecursive(join(REPO_ROOT, "frontend"), /\.(tsx?|css|svg)$/, FRONTEND_EXCLUDED_DIR_NAMES).map(
    normalizeRelPath,
  );

  test("at least one root and one frontend source file is discovered (prerequisite)", () => {
    expect(rootDiscovered.length).toBeGreaterThan(0);
    expect(frontendDiscovered.length).toBeGreaterThan(0);
  });

  test(
    "every discovered root .ts/.tsx file appears in 'lint:root's real verbose-processed file list",
    () => {
      const { files, combined } = runVerbosePinnedBiome(".", "biome.root.json");
      const processedSet = new Set(files);
      const missing = rootDiscovered.filter((f) => !processedSet.has(f));
      expect(missing, `not processed by biome.root.json:\n${missing.join("\n")}\n\n${combined.slice(0, 500)}`).toEqual(
        [],
      );
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "every discovered frontend .ts/.tsx/.css/.svg file appears in 'lint:frontend's real verbose-processed file list",
    () => {
      const { files, combined } = runVerbosePinnedBiome("frontend", "biome.json");
      const processedSet = new Set(files);
      const missing = frontendDiscovered.filter((f) => !processedSet.has(f));
      expect(missing, `not processed by biome.json (frontend scope):\n${missing.join("\n")}\n\n${combined.slice(0, 500)}`).toEqual(
        [],
      );
    },
    EXEC_TIMEOUT_MS,
  );
});

// --------------------------- requirement: no rule/group downgrade ---------------------------

interface BiomeConfigShape {
  extends?: string[];
  files?: { includes?: string[] };
  linter?: { enabled?: boolean; rules?: Record<string, unknown> };
  css?: { linter?: { enabled?: boolean }; parser?: Record<string, unknown> };
}

function readBiomeConfig(fileName: string): BiomeConfigShape {
  return JSON.parse(readFileSync(join(REPO_ROOT, fileName), "utf8")) as BiomeConfigShape;
}

/** Depth-first search for a rule-name key anywhere in the linter.rules tree, returning its configured level (string form, or the `.level` of an options object). Returns undefined if the rule key is never overridden (i.e. it still uses the preset default). */
function findRuleLevelOverride(node: unknown, ruleName: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === ruleName) {
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && "level" in (value as Record<string, unknown>)) {
        return String((value as Record<string, unknown>).level);
      }
    }
    if (value && typeof value === "object") {
      const nested = findRuleLevelOverride(value, ruleName);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/**
 * True if the named rule *group* (e.g. "a11y", "suspicious") is downgraded
 * at all: a bare `"off"`/`"warn"`/`"info"` string, or an options object with
 * `"recommended": false` - REGARDLESS of whether specific rules are
 * individually re-enabled inside it. A partial downgrade
 * (`{ "recommended": false, "noSvgWithoutTitle": "error" }`) still turns off
 * every *other* recommended rule in that group - including other
 * currently-erroring rules in the same group - so it is rejected exactly
 * like a full group disable. This is the brief's explicitly preferred,
 * simpler contract: reject all such group downgrades, not just total ones.
 */
function isGroupDisabled(rulesTree: Record<string, unknown> | undefined, groupName: string): boolean {
  const group = rulesTree?.[groupName];
  if (group === undefined) return false;
  if (typeof group === "string") return group === "off" || group === "warn" || group === "info";
  if (group && typeof group === "object") {
    const asRecord = group as Record<string, unknown>;
    return asRecord.recommended === false;
  }
  return false;
}

describe("findRuleLevelOverride / isGroupDisabled helper correctness", () => {
  test("finds a rule overridden as a bare string, nested under its group", () => {
    const rules = { suspicious: { noExplicitAny: "off" } };
    expect(findRuleLevelOverride(rules, "noExplicitAny")).toBe("off");
  });

  test("finds a rule overridden as an options object with a level", () => {
    const rules = { suspicious: { noExplicitAny: { level: "warn", options: {} } } };
    expect(findRuleLevelOverride(rules, "noExplicitAny")).toBe("warn");
  });

  test("returns undefined when the rule is never mentioned", () => {
    expect(findRuleLevelOverride({ suspicious: {} }, "noExplicitAny")).toBeUndefined();
  });

  test("detects a bare 'off' group disable", () => {
    expect(isGroupDisabled({ a11y: "off" }, "a11y")).toBe(true);
  });

  test("detects a bare 'warn' group downgrade", () => {
    expect(isGroupDisabled({ a11y: "warn" }, "a11y")).toBe(true);
  });

  test("detects a bare 'info' group downgrade", () => {
    expect(isGroupDisabled({ a11y: "info" }, "a11y")).toBe(true);
  });

  test("detects a '{ recommended: false }' group disable with nothing re-enabled", () => {
    expect(isGroupDisabled({ a11y: { recommended: false } }, "a11y")).toBe(true);
  });

  test("STILL flags a partial group downgrade that re-enables one specific rule (the review counterexample: recommended:false with only noSvgWithoutTitle re-enabled leaves useButtonType/noLabelWithoutControl/useKeyWithClickEvents silently off)", () => {
    expect(isGroupDisabled({ a11y: { recommended: false, noSvgWithoutTitle: "error" } }, "a11y")).toBe(true);
  });

  test("does not flag an untouched group", () => {
    expect(isGroupDisabled({}, "a11y")).toBe(false);
  });

  test("does not flag a group with recommended left untouched (only individual rules configured)", () => {
    expect(isGroupDisabled({ a11y: { noSvgWithoutTitle: "error" } }, "a11y")).toBe(false);
  });
});

// The full set of lint rule IDs producing the current 92 errors (from the
// real pinned binary's `--reporter=summary` rule table at authoring time).
// A conforming fix resolves each underlying violation; it must not instead
// set any of these to "off"/"warn"/"info" in either config file.
const CURRENT_ERROR_RULE_NAMES = [
  "noControlCharactersInRegex",
  "useExhaustiveDependencies",
  "useIterableCallbackReturn",
  "noShadowRestrictedNames",
  "noAssignInExpressions",
  "noStaticElementInteractions",
  "noInnerDeclarations",
  "noUnknownAtRules",
  "noImplicitAnyLet",
  "noArrayIndexKey",
  "useKeyWithClickEvents",
  "noLabelWithoutControl",
  "noSvgWithoutTitle",
  "useButtonType",
];

const CURRENT_ERROR_RULE_GROUPS = ["a11y", "suspicious", "correctness", "complexity"];

const CONFIG_FILES = ["biome.json", "biome.root.json"];

describe("no currently-erroring rule is downgraded to a non-error severity (anti-bypass)", () => {
  for (const configFile of CONFIG_FILES) {
    for (const ruleName of CURRENT_ERROR_RULE_NAMES) {
      test(`${configFile}: '${ruleName}' is not overridden to off/warn/info`, () => {
        const config = readBiomeConfig(configFile);
        const level = findRuleLevelOverride(config.linter?.rules, ruleName);
        if (level !== undefined) {
          expect(["off", "warn", "info"]).not.toContain(level);
        }
      });
    }
  }
});

describe("no rule group that currently produces errors is disabled wholesale (anti-bypass)", () => {
  for (const configFile of CONFIG_FILES) {
    for (const groupName of CURRENT_ERROR_RULE_GROUPS) {
      test(`${configFile}: '${groupName}' group is not disabled`, () => {
        const config = readBiomeConfig(configFile);
        expect(isGroupDisabled(config.linter?.rules as Record<string, unknown> | undefined, groupName)).toBe(false);
      });
    }
  }
});

describe("linter and the recommended preset remain enabled (anti-bypass)", () => {
  test("biome.json: linter.enabled is true and rules.preset is 'recommended'", () => {
    const config = readBiomeConfig("biome.json");
    expect(config.linter?.enabled).toBe(true);
    const rules = config.linter?.rules as { preset?: unknown } | undefined;
    expect(rules?.preset).toBe("recommended");
  });

  test("biome.root.json: still extends biome.json (inherits linter.enabled/preset rather than redeclaring them)", () => {
    const config = readBiomeConfig("biome.root.json");
    expect(config.extends ?? []).toContain("./biome.json");
  });

  test("biome.root.json: if it redeclares linter settings at all, they are not weaker than the base config", () => {
    const config = readBiomeConfig("biome.root.json");
    if (config.linter?.enabled !== undefined) {
      expect(config.linter.enabled).toBe(true);
    }
    const rules = config.linter?.rules as { preset?: unknown } | undefined;
    if (rules?.preset !== undefined) {
      expect(rules.preset).toBe("recommended");
    }
  });
});

// --------------------------- requirement 3 anti-bypass: CSS linting stays real ---------------------------

describe("CSS linting is fixed, not disabled or excluded (anti-bypass for requirement 3)", () => {
  for (const configFile of CONFIG_FILES) {
    test(`${configFile}: css.linter.enabled is not explicitly false`, () => {
      const config = readBiomeConfig(configFile);
      expect(config.css?.linter?.enabled).not.toBe(false);
    });

    test(`${configFile}: files.includes has no new CSS-excluding pattern`, () => {
      const config = readBiomeConfig(configFile);
      const includes = config.files?.includes ?? [];
      const cssExclusions = includes.filter((pattern) => pattern.startsWith("!") && /\.css\b|\*\*\/css\/?\*\*/i.test(pattern));
      expect(cssExclusions, JSON.stringify(includes)).toEqual([]);
    });
  }

  test(
    "the real pinned binary still checks at least one .css file under frontend/src",
    () => {
      expect(checkedFileCount("frontend/src/index.css", "biome.json")).toBeGreaterThan(0);
    },
    EXEC_TIMEOUT_MS,
  );
});

// --------------------------- requirement 7 anti-bypass: no ambient any-shims for missing declarations ---------------------------

// ---------------------------------------------------------------------------
// `bun run typecheck:root` currently fails with real TS7016 "Could not find
// a declaration file" errors for these bare package specifiers (confirmed
// against the real pinned tsc at authoring time). The brief requires
// "maintained declaration packages ... preferred over local `declare module`
// shims" - so a compiler-green fix that instead adds
// `declare module "minimist";` (or a wildcard `declare module "*";`) locally
// would make the diagnostic disappear via an implicit `any` shim rather than
// installing/using the real @types package, without ever showing up as an
// explicit `any` token or increasing the noExplicitAny count. This guard
// closes exactly that escape.
// ---------------------------------------------------------------------------

function productionSourceFiles(): string[] {
  const root = discoverFilesRecursive(REPO_ROOT, /\.tsx?$/, ROOT_EXCLUDED_DIR_NAMES);
  const frontendSrc = discoverFilesRecursive(join(REPO_ROOT, "frontend", "src"), /\.tsx?$/, new Set(["node_modules"]));
  return [...root, ...frontendSrc];
}

function countMatches(files: string[], pattern: RegExp): number {
  let total = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const matches = source.match(pattern);
    total += matches ? matches.length : 0;
  }
  return total;
}

/** Extracts the module specifier of every top-level `declare module "...";` / `declare module '...' { ... }` statement in `source`. */
function findAmbientModuleSpecifiers(source: string): string[] {
  const matches = [...source.matchAll(/\bdeclare\s+module\s+(["'])((?:\\.|(?!\1).)*)\1/g)];
  return matches.map((m) => m[2]);
}

// The exact bare package specifiers the real pinned tsc currently reports as
// missing a declaration file (TS7016) under `bun run typecheck:root`.
const CURRENTLY_MISSING_DECLARATION_PACKAGES = ["minimist", "js-yaml", "libmime", "mailparser", "node-forge", "xmldom"];

function isAmbientShimForMissingPackage(specifier: string): boolean {
  if (specifier.includes("*")) return true; // any wildcard shim is a blanket any-escape
  return CURRENTLY_MISSING_DECLARATION_PACKAGES.some(
    (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
  );
}

describe("findAmbientModuleSpecifiers / isAmbientShimForMissingPackage helper correctness", () => {
  test("extracts a double-quoted bare declare module specifier", () => {
    expect(findAmbientModuleSpecifiers('declare module "minimist";')).toEqual(["minimist"]);
  });

  test("extracts a single-quoted declare module specifier with a body", () => {
    expect(findAmbientModuleSpecifiers("declare module 'js-yaml' {\n  export function load(s: string): unknown;\n}")).toEqual([
      "js-yaml",
    ]);
  });

  test("extracts multiple declare module statements from one file", () => {
    const source = 'declare module "minimist";\ndeclare module "js-yaml";\n';
    expect(findAmbientModuleSpecifiers(source)).toEqual(["minimist", "js-yaml"]);
  });

  test("returns an empty array when there is no ambient module declaration", () => {
    expect(findAmbientModuleSpecifiers('import minimist from "minimist";')).toEqual([]);
  });

  test("flags an exact-name shim for a currently-missing package", () => {
    expect(isAmbientShimForMissingPackage("minimist")).toBe(true);
    expect(isAmbientShimForMissingPackage("js-yaml")).toBe(true);
    expect(isAmbientShimForMissingPackage("libmime")).toBe(true);
    expect(isAmbientShimForMissingPackage("mailparser")).toBe(true);
    expect(isAmbientShimForMissingPackage("node-forge")).toBe(true);
    expect(isAmbientShimForMissingPackage("xmldom")).toBe(true);
  });

  test("flags a subpath shim for a currently-missing package", () => {
    expect(isAmbientShimForMissingPackage("js-yaml/types")).toBe(true);
  });

  test("flags any wildcard module shim regardless of package name", () => {
    expect(isAmbientShimForMissingPackage("*")).toBe(true);
    expect(isAmbientShimForMissingPackage("*.svg")).toBe(true);
  });

  test("does not flag an unrelated, non-wildcard module specifier", () => {
    expect(isAmbientShimForMissingPackage("./local-module")).toBe(false);
    expect(isAmbientShimForMissingPackage("some-other-package")).toBe(false);
  });
});

describe("no new local ambient 'declare module' shim for a currently-missing declaration package (anti-bypass for requirement 7)", () => {
  // Authoring-time baseline: zero `declare module` statements anywhere in
  // root application source or frontend/src.
  const files = productionSourceFiles();

  test("zero ambient module shims target minimist/js-yaml/libmime/mailparser/node-forge/xmldom or any wildcard", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of findAmbientModuleSpecifiers(source)) {
        if (isAmbientShimForMissingPackage(specifier)) {
          violations.push(`${file.replace(REPO_ROOT, "")}: declare module "${specifier}"`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("zero ambient module shims at all (any new local shim should instead be a maintained @types package or a narrow typed adapter)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of findAmbientModuleSpecifiers(source)) {
        violations.push(`${file.replace(REPO_ROOT, "")}: declare module "${specifier}"`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("suppression-directive counts do not increase in production source (anti-bypass)", () => {
  // Authoring-time baseline: zero in every category below, across root
  // application source and frontend/src.
  const files = productionSourceFiles();

  test("no 'biome-ignore' suppression comments (baseline: 0)", () => {
    expect(countMatches(files, /biome-ignore/g)).toBeLessThanOrEqual(0);
  });

  test("no '@ts-ignore' suppression comments (baseline: 0)", () => {
    expect(countMatches(files, /@ts-ignore/g)).toBeLessThanOrEqual(0);
  });

  test("no '@ts-nocheck' suppression comments (baseline: 0)", () => {
    expect(countMatches(files, /@ts-nocheck/g)).toBeLessThanOrEqual(0);
  });

  // A production fix could place `@ts-expect-error` immediately before each
  // existing strict-mode diagnostic line instead of actually narrowing the
  // type - `bun run typecheck` reports zero errors (the directive silences
  // exactly the expected diagnostic and TS treats an unused
  // `@ts-expect-error` as its own error, so this specific escape happens to
  // be self-policing in TS's own diagnostics too), but it would not trip
  // any of the other suppression-directive or unchecked-`any` guards in
  // this describe block.
  test("no '@ts-expect-error' suppression comments (baseline: 0)", () => {
    expect(countMatches(files, /@ts-expect-error/g)).toBeLessThanOrEqual(0);
  });

  test("no 'eslint-disable' suppression comments (baseline: 0)", () => {
    expect(countMatches(files, /eslint-disable/g)).toBeLessThanOrEqual(0);
  });

  test("no empty catch blocks (baseline: 0)", () => {
    expect(countMatches(files, /catch\s*(\([^)]*\))?\s*\{\s*\}/g)).toBeLessThanOrEqual(0);
  });

  test("'as unknown as' double-cast usage does not exceed the pre-fix baseline", () => {
    // Authoring-time baseline: 5 occurrences, both in frontend/src/lib.
    expect(countMatches(files, /as unknown as/g)).toBeLessThanOrEqual(5);
  });
});

describe("noExplicitAny / noNonNullAssertion diagnostic counts do not increase (anti-bypass; the real 'convert error to more any/! usage' escape)", () => {
  // Both tests below probe the identical `bun run lint -- --reporter=summary`
  // command; cache the one real spawn rather than running it twice.
  const bunScriptCache = new Map<string, { combined: string }>();

  function runBunScript(scriptName: string, extraArgs: string[] = []): { combined: string } {
    const cacheKey = JSON.stringify([scriptName, extraArgs]);
    const cached = bunScriptCache.get(cacheKey);
    if (cached) return cached;
    const args = extraArgs.length > 0 ? ["run", scriptName, "--", ...extraArgs] : ["run", scriptName];
    const proc = Bun.spawnSync({ cmd: ["bun", ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
    const result = { combined: `${proc.stdout.toString()}\n${proc.stderr.toString()}` };
    bunScriptCache.set(cacheKey, result);
    return result;
  }

  function ruleDiagnosticCount(summaryOutput: string, ruleId: string): number {
    const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = summaryOutput.match(new RegExp(`lint/[\\w/-]+/${escaped}\\s+(\\d+)`));
    return match ? Number(match[1]) : 0;
  }

  test(
    "aggregate lint noExplicitAny diagnostic count does not exceed the pre-fix baseline (416)",
    () => {
      const { combined } = runBunScript("lint", ["--reporter=summary"]);
      expect(ruleDiagnosticCount(combined, "noExplicitAny"), combined).toBeLessThanOrEqual(416);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "aggregate lint noNonNullAssertion diagnostic count does not exceed the pre-fix baseline (45)",
    () => {
      const { combined } = runBunScript("lint", ["--reporter=summary"]);
      expect(ruleDiagnosticCount(combined, "noNonNullAssertion"), combined).toBeLessThanOrEqual(45);
    },
    EXEC_TIMEOUT_MS,
  );
});
