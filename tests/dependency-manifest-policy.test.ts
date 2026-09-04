import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the direct-dependency manifest contract from the
// `p1-dependency-ci-security-baseline` requirements brief (roadmap Packet 1,
// B4 + H1-H3 + S7 supply-chain portion): safe version floors for the five
// packages implicated in the current `bun audit` Critical/High findings,
// removal of misclassified/unused packages, and the `xmldom` ->
// `@xmldom/xmldom` migration at the manifest level.
//
// Kept deliberately offline/deterministic: pure manifest parsing plus a
// small self-contained semver comparator, no network, no `bun audit`.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
}

function readPackageJson(path: string): PackageJsonShape {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJsonShape;
}

const rootPackageJson = readPackageJson(join(REPO_ROOT, "package.json"));
const frontendPackageJson = readPackageJson(join(FRONTEND_DIR, "package.json"));
const indexTsSource = readFileSync(join(REPO_ROOT, "index.ts"), "utf8");

// ---------------------------------------------------------------------------
// Semver helpers - deliberately hand-rolled rather than importing a package
// under test, and covering multi-digit segments + prerelease ordering per
// the brief's "compare semantic versions correctly" requirement.
// ---------------------------------------------------------------------------

type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string[] };

function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Standard semver precedence: numeric segments compare numerically; a version with a prerelease is lower than the same version without one; prerelease identifiers compare part-by-part. */
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`cannot compare invalid version(s): '${a}' vs '${b}'`);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const pa_i = pa.prerelease[i];
    const pb_i = pb.prerelease[i];
    if (pa_i === undefined) return -1;
    if (pb_i === undefined) return 1;
    const na = Number(pa_i);
    const nb = Number(pb_i);
    const aIsNum = /^\d+$/.test(pa_i);
    const bIsNum = /^\d+$/.test(pb_i);
    if (aIsNum && bIsNum) {
      if (na !== nb) return na - nb;
      continue;
    }
    if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
    if (pa_i !== pb_i) return pa_i < pb_i ? -1 : 1;
  }
  return 0;
}

/** Suspicious/unsafe dependency specifier forms that must never be treated as satisfying a version floor, regardless of any version string embedded in them. */
const SUSPICIOUS_SPECIFIER_PATTERN = /^(npm:|git\+|git:|github:|https?:\/\/|file:|link:|workspace:)|#/;

function isSuspiciousSpecifier(range: string): boolean {
  return SUSPICIOUS_SPECIFIER_PATTERN.test(range.trim());
}

/** Extracts the minimum version a range guarantees, for the safe/plain forms this policy accepts (^, ~, >=, or an exact pin). Returns null for anything else (wildcards, "latest", OR-ranges, hyphen ranges, aliases, git/url specifiers). */
function minVersionOfRange(range: string): string | null {
  const trimmed = range.trim();
  if (isSuspiciousSpecifier(trimmed)) return null;
  if (trimmed === "*" || trimmed === "latest" || trimmed.includes("||") || trimmed.includes(" - ")) return null;
  const caretOrTilde = /^[\^~](\d+\.\d+\.\d+.*)$/.exec(trimmed);
  if (caretOrTilde) return parseVersion(caretOrTilde[1]) ? caretOrTilde[1] : null;
  const gte = /^>=\s*(\d+\.\d+\.\d+.*)$/.exec(trimmed);
  if (gte) return parseVersion(gte[1]) ? gte[1] : null;
  if (parseVersion(trimmed)) return trimmed;
  return null;
}

function meetsFloor(range: string | undefined, floor: string): boolean {
  if (!range) return false;
  if (isSuspiciousSpecifier(range)) return false;
  const min = minVersionOfRange(range);
  if (!min) return false;
  return compareVersions(min, floor) >= 0;
}

describe("semver comparator correctness (multi-digit segments, prereleases, boundaries)", () => {
  test("multi-digit minor segments compare numerically, not lexicographically", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("4.9.0", "4.12.34")).toBeLessThan(0);
  });

  test("multi-digit patch segments compare numerically", () => {
    expect(compareVersions("3.9.8", "3.9.20")).toBeLessThan(0);
    expect(compareVersions("3.9.20", "3.9.8")).toBeGreaterThan(0);
  });

  test("a prerelease version is lower than the same release version", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
  });

  test("prerelease identifiers compare part by part", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.2")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10")).toBeLessThan(0);
  });

  test("equal versions compare as zero", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("minVersionOfRange / meetsFloor helper correctness", () => {
  test("resolves caret, tilde, >=, and exact-pin minimums", () => {
    expect(minVersionOfRange("^1.18.0")).toBe("1.18.0");
    expect(minVersionOfRange("~1.18.0")).toBe("1.18.0");
    expect(minVersionOfRange(">=1.18.0")).toBe("1.18.0");
    expect(minVersionOfRange("1.18.0")).toBe("1.18.0");
  });

  test("returns null for wildcard, latest, OR-ranges, and hyphen ranges", () => {
    expect(minVersionOfRange("*")).toBeNull();
    expect(minVersionOfRange("latest")).toBeNull();
    expect(minVersionOfRange("^1.0.0 || ^2.0.0")).toBeNull();
    expect(minVersionOfRange("1.0.0 - 2.0.0")).toBeNull();
  });

  test("returns null for git/url/npm-alias/workspace specifiers even when a high version is embedded", () => {
    expect(minVersionOfRange("git+https://github.com/axios/axios.git#v1.99.0")).toBeNull();
    expect(minVersionOfRange("github:axios/axios#v1.99.0")).toBeNull();
    expect(minVersionOfRange("npm:axios@1.99.0")).toBeNull();
    expect(minVersionOfRange("https://example.com/axios-1.99.0.tgz")).toBeNull();
    expect(minVersionOfRange("file:../local-axios")).toBeNull();
    expect(minVersionOfRange("workspace:*")).toBeNull();
  });

  test("boundary: exactly-at-floor passes, one-below fails, one-above passes", () => {
    expect(meetsFloor("^1.18.0", "1.18.0")).toBe(true);
    expect(meetsFloor("^1.17.9", "1.18.0")).toBe(false);
    expect(meetsFloor("^1.18.1", "1.18.0")).toBe(true);
  });

  test("undefined range never meets a floor", () => {
    expect(meetsFloor(undefined, "1.18.0")).toBe(false);
  });
});

describe("safe direct dependency floors resolve the current advisories (requirement 2)", () => {
  const FLOORS: Array<[pkg: string, floor: string]> = [
    ["axios", "1.18.0"],
    ["hono", "4.12.34"],
    ["js-yaml", "4.3.1"],
    ["mailparser", "3.9.20"],
    ["@xmldom/xmldom", "0.9.12"],
  ];

  for (const [pkg, floor] of FLOORS) {
    test(`root dependencies['${pkg}'] is declared and meets the >= ${floor} floor via a safe range form`, () => {
      const range = rootPackageJson.dependencies?.[pkg];
      expect(range, `dependencies['${pkg}'] must be declared`).toBeDefined();
      expect(isSuspiciousSpecifier(range as string), `'${pkg}' range '${range}' must not be a git/url/npm-alias specifier`).toBe(
        false,
      );
      expect(meetsFloor(range, floor), `'${pkg}' range '${range}' must resolve to at least ${floor}`).toBe(true);
    });
  }
});

describe("xmldom replaced by the maintained @xmldom/xmldom package (requirement 1)", () => {
  test("legacy 'xmldom' is fully removed from root dependencies", () => {
    expect(rootPackageJson.dependencies?.xmldom).toBeUndefined();
  });

  test("legacy '@types/xmldom' and unused '@types/xml' are removed from root devDependencies (requirement 3)", () => {
    expect(rootPackageJson.devDependencies?.["@types/xmldom"]).toBeUndefined();
    expect(rootPackageJson.devDependencies?.["@types/xml"]).toBeUndefined();
  });

  test("legacy 'xmldom' is not merely relocated into devDependencies", () => {
    expect(rootPackageJson.devDependencies?.xmldom).toBeUndefined();
  });
});

describe("misclassified/unused package removals (requirement 3)", () => {
  test("runtime 'bun' package dependency is removed", () => {
    expect(rootPackageJson.dependencies?.bun).toBeUndefined();
    expect(rootPackageJson.devDependencies?.bun).toBeUndefined();
  });

  test("'bun-types' is removed (superseded by the single '@types/bun' source)", () => {
    expect(rootPackageJson.dependencies?.["bun-types"]).toBeUndefined();
    expect(rootPackageJson.devDependencies?.["bun-types"]).toBeUndefined();
  });

  test("'@types/bun' remains as the single Bun type source", () => {
    expect(rootPackageJson.devDependencies?.["@types/bun"], "@types/bun must still be declared").toBeDefined();
  });

  test("third-party 'readline' package dependency is removed", () => {
    expect(rootPackageJson.dependencies?.readline).toBeUndefined();
  });

  test("unused frontend 'zod' dependency is removed", () => {
    expect(frontendPackageJson.dependencies?.zod).toBeUndefined();
    expect(frontendPackageJson.devDependencies?.zod).toBeUndefined();
  });

  test("unused frontend '@hookform/resolvers' dependency is removed", () => {
    expect(frontendPackageJson.dependencies?.["@hookform/resolvers"]).toBeUndefined();
    expect(frontendPackageJson.devDependencies?.["@hookform/resolvers"]).toBeUndefined();
  });
});

describe("index.ts uses the native node:readline module (requirement 3)", () => {
  test("imports from 'node:readline', not the bare 'readline' specifier", () => {
    expect(/from\s+["']node:readline["']/.test(indexTsSource)).toBe(true);
    expect(/from\s+["']readline["']/.test(indexTsSource)).toBe(false);
  });
});

describe("anti-bypass: no aliasing/git/url specifier defeats a version-floor check (adversarial requirement)", () => {
  const FLOOR_PACKAGES = ["axios", "hono", "js-yaml", "mailparser", "@xmldom/xmldom"];
  const REMOVED_PACKAGES = ["xmldom", "bun", "bun-types", "readline"];

  test("no floor-relevant package uses an npm-alias, git, url, file, link, or workspace specifier", () => {
    for (const pkg of FLOOR_PACKAGES) {
      const range = rootPackageJson.dependencies?.[pkg];
      if (range === undefined) continue; // covered by the dedicated "is declared" test above
      expect(isSuspiciousSpecifier(range), `dependencies['${pkg}'] = '${range}' must be a plain registry range`).toBe(false);
    }
  });

  test("no 'overrides'/'resolutions' entry silently pins a floor-relevant package below its floor", () => {
    const FLOORS: Record<string, string> = {
      axios: "1.18.0",
      hono: "4.12.34",
      "js-yaml": "4.3.1",
      mailparser: "3.9.20",
      "@xmldom/xmldom": "0.9.12",
      "form-data": "4.0.6",
      "linkify-it": "5.0.2",
      undici: "7.29.0",
    };
    const overrideMaps = [rootPackageJson.overrides, rootPackageJson.resolutions].filter(
      (m): m is Record<string, string> => !!m,
    );
    for (const map of overrideMaps) {
      for (const [pkg, floor] of Object.entries(FLOORS)) {
        const overrideRange = map[pkg];
        if (overrideRange === undefined) continue;
        expect(
          meetsFloor(overrideRange, floor),
          `overrides/resolutions['${pkg}'] = '${overrideRange}' must not downgrade below ${floor}`,
        ).toBe(true);
      }
    }
  });

  test("no removed package reappears disguised as an override/resolution entry", () => {
    const overrideMaps = [rootPackageJson.overrides, rootPackageJson.resolutions].filter(
      (m): m is Record<string, string> => !!m,
    );
    for (const map of overrideMaps) {
      for (const pkg of REMOVED_PACKAGES) {
        expect(map[pkg], `overrides/resolutions must not reintroduce '${pkg}'`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Gap 5 (lead review): manifest-level removal is necessary but not
// sufficient - a package can be dropped from package.json while a production
// module still imports/requires it by its old bare specifier, which every
// manifest/lock assertion above is blind to and which only fails at runtime.
// This scans every root production `.ts`/`.tsx` file (the same surface root
// `tsconfig.json` compiles: repo root minus `frontend`, `node_modules`,
// `public`, and `tests`) for a bare import/require of each removed
// specifier, in both `import ... from "x"` and `require("x")` form.
// ---------------------------------------------------------------------------

const ROOT_PRODUCTION_EXCLUDED_DIR_NAMES = new Set(["frontend", "node_modules", "public", "tests", ".git"]);

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

function rootProductionSourceFiles(): string[] {
  return discoverFilesRecursive(REPO_ROOT, /\.tsx?$/, ROOT_PRODUCTION_EXCLUDED_DIR_NAMES);
}

/** True when `source` imports or requires the exact bare `specifier` - not a prefixed/scoped variant like `node:readline` or `@xmldom/xmldom`. Covers `import ... from "x"`, side-effect `import "x"`, and `require("x")`. */
function importsOrRequiresBareSpecifier(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fromImportPattern = new RegExp(`\\bfrom\\s+["']${escaped}["']`);
  const sideEffectImportPattern = new RegExp(`^\\s*import\\s+["']${escaped}["']`, "m");
  const requirePattern = new RegExp(`\\brequire\\(\\s*["']${escaped}["']\\s*\\)`);
  return fromImportPattern.test(source) || sideEffectImportPattern.test(source) || requirePattern.test(source);
}

describe("importsOrRequiresBareSpecifier helper correctness", () => {
  test("detects a bare named import", () => {
    expect(importsOrRequiresBareSpecifier('import { createInterface } from "readline";', "readline")).toBe(true);
  });

  test("detects a bare require() call", () => {
    expect(importsOrRequiresBareSpecifier('const xmldom = require("xmldom");', "xmldom")).toBe(true);
  });

  test("detects a bare side-effect-only import", () => {
    expect(importsOrRequiresBareSpecifier('import "xmldom";', "xmldom")).toBe(true);
  });

  test("does not false-positive on the node: prefixed form", () => {
    expect(importsOrRequiresBareSpecifier('import { createInterface } from "node:readline";', "readline")).toBe(false);
  });

  test("does not false-positive on the scoped @xmldom/xmldom form", () => {
    expect(importsOrRequiresBareSpecifier('import { DOMParser } from "@xmldom/xmldom";', "xmldom")).toBe(false);
  });

  test("does not false-positive on an unrelated specifier that merely contains the target as a substring", () => {
    expect(importsOrRequiresBareSpecifier('import x from "not-readline-at-all";', "readline")).toBe(false);
  });
});

describe("anti-bypass: removed packages do not survive as production imports (requirement 1 + 3, gap 5)", () => {
  const files = rootProductionSourceFiles();
  const REMOVED_BARE_SPECIFIERS = ["xmldom", "readline", "bun-types", "@types/xml", "@types/xmldom"];

  test("rootProductionSourceFiles() discovers at least index.ts and the feed parser utility (sanity check for the scan itself)", () => {
    const normalized = files.map((f) => f.replaceAll("\\", "/"));
    expect(normalized.some((f) => f.endsWith("/index.ts"))).toBe(true);
    expect(normalized.some((f) => f.endsWith("/utilities/existing-feed-parser.utility.ts"))).toBe(true);
  });

  for (const specifier of REMOVED_BARE_SPECIFIERS) {
    test(`no root production file imports/requires the bare '${specifier}' specifier`, () => {
      const violations: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        if (importsOrRequiresBareSpecifier(source, specifier)) {
          violations.push(file.replace(REPO_ROOT, ""));
        }
      }
      expect(violations, violations.join("\n")).toEqual([]);
    });
  }
});
