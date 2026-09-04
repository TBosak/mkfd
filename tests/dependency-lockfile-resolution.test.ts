import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the frozen-lock-graph contract from the
// `p1-dependency-ci-security-baseline` requirements brief: the *resolved*
// (not merely declared) transitive versions that close the current
// `bun audit` Critical/High findings, plus manifest<->lockfile consistency
// (a stale or hand-edited lockfile is itself an anti-bypass vector, since
// `bun install --frozen-lockfile` only proves the lockfile is internally
// self-consistent, not that it still matches the manifest ranges CI reads).
//
// `bun.lock` is a trailing-comma-tolerant JSON dialect (not parsed by
// `JSON.parse` directly). Parsing it here - rather than grepping text - is
// what lets these assertions target the *real resolved version* of a
// possibly-nested/vendored copy of a package, not just the first textual
// mention.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");

interface BunLockShape {
  workspaces?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
  packages?: Record<string, unknown[]>;
}

/** Parses bun.lock's trailing-comma-tolerant JSON dialect by stripping commas that immediately precede a closing brace/bracket, then delegating to JSON.parse. */
function parseBunLock(path: string): BunLockShape {
  const text = readFileSync(path, "utf8");
  const stripped = text.replace(/,(\s*[}\]])/g, (_match, closer: string) => closer);
  return JSON.parse(stripped) as BunLockShape;
}

const rootLock = parseBunLock(join(REPO_ROOT, "bun.lock"));
const frontendLock = parseBunLock(join(FRONTEND_DIR, "bun.lock"));

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
    const aIsNum = /^\d+$/.test(pa_i);
    const bIsNum = /^\d+$/.test(pb_i);
    if (aIsNum && bIsNum) {
      const diff = Number(pa_i) - Number(pb_i);
      if (diff !== 0) return diff;
      continue;
    }
    if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
    if (pa_i !== pb_i) return pa_i < pb_i ? -1 : 1;
  }
  return 0;
}

/**
 * Every resolved version of `pkgName` anywhere in the lock's flat `packages`
 * map, including bun's nested-path keys (e.g. `"parent/pkg"`) used when a
 * dependency resolves to more than one version across the graph. Returns one
 * entry per distinct resolution path, not deduplicated by version, so a
 * vulnerable *nested* copy is caught even when the top-level/hoisted copy is
 * safe.
 */
function allResolutionsOf(lock: BunLockShape, pkgName: string): Array<{ key: string; version: string }> {
  const packages = lock.packages ?? {};
  const results: Array<{ key: string; version: string }> = [];
  for (const [key, entry] of Object.entries(packages)) {
    const isMatch = key === pkgName || key.endsWith(`/${pkgName}`);
    if (!isMatch) continue;
    const first = entry[0];
    if (typeof first !== "string" || !first.startsWith(`${pkgName}@`)) continue;
    results.push({ key, version: first.slice(pkgName.length + 1) });
  }
  return results;
}

describe("parseBunLock / allResolutionsOf helper correctness", () => {
  test("strips trailing commas before closing braces/brackets and parses valid JSON underneath", () => {
    expect(rootLock.packages).toBeDefined();
    expect(rootLock.workspaces?.[""]).toBeDefined();
  });

  test("finds a top-level flat resolution by exact key", () => {
    const resolved = allResolutionsOf(rootLock, "cheerio");
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0].version.length).toBeGreaterThan(0);
  });

  test("finds a nested-path resolution (key ending in '/pkgName') as well as a bare one", () => {
    const fixtureLock: BunLockShape = {
      packages: {
        "form-data": ["form-data@4.0.6", "", {}, "sha512-fixture-top=="],
        "legacy-lib/form-data": ["form-data@2.5.1", "", {}, "sha512-fixture-nested=="],
      },
    };
    const resolved = allResolutionsOf(fixtureLock, "form-data");
    expect(resolved.map((r) => r.version).sort()).toEqual(["2.5.1", "4.0.6"]);
  });

  test("does not false-positive on an unrelated package whose name merely contains the target as a substring", () => {
    const fixtureLock: BunLockShape = {
      packages: {
        "form-data-encoder": ["form-data-encoder@1.0.0", "", {}, "sha512-fixture=="],
      },
    };
    expect(allResolutionsOf(fixtureLock, "form-data")).toEqual([]);
  });
});

describe("transitive lock resolutions close the current advisories (requirement 2)", () => {
  const AT_LEAST_FLOORS: Array<[pkg: string, floor: string]> = [
    ["form-data", "4.0.6"],
    ["linkify-it", "5.0.2"],
    ["undici", "7.29.0"],
  ];

  for (const [pkg, floor] of AT_LEAST_FLOORS) {
    test(`every resolved '${pkg}' in the root lock graph is at least ${floor}`, () => {
      const resolutions = allResolutionsOf(rootLock, pkg);
      expect(resolutions.length, `'${pkg}' must appear in the resolved lock graph`).toBeGreaterThan(0);
      for (const { key, version } of resolutions) {
        expect(compareVersions(version, floor), `resolution at '${key}' = ${version} must be >= ${floor}`).toBeGreaterThanOrEqual(
          0,
        );
      }
    });
  }

  test("every resolved 'nodemailer' in the root lock graph is strictly above 9.0.0", () => {
    const resolutions = allResolutionsOf(rootLock, "nodemailer");
    expect(resolutions.length, "'nodemailer' must appear in the resolved lock graph").toBeGreaterThan(0);
    for (const { key, version } of resolutions) {
      expect(compareVersions(version, "9.0.0"), `resolution at '${key}' = ${version} must be > 9.0.0`).toBeGreaterThan(0);
    }
  });
});

describe("xmldom -> @xmldom/xmldom migration reflected in the resolved lock graph (requirement 1)", () => {
  test("no resolution of legacy 'xmldom' remains anywhere in the root lock graph", () => {
    expect(allResolutionsOf(rootLock, "xmldom")).toEqual([]);
  });

  test("'@xmldom/xmldom' resolves in the root lock graph to at least 0.9.12", () => {
    const resolutions = allResolutionsOf(rootLock, "@xmldom/xmldom");
    expect(resolutions.length, "'@xmldom/xmldom' must appear in the resolved lock graph").toBeGreaterThan(0);
    for (const { key, version } of resolutions) {
      expect(compareVersions(version, "0.9.12"), `resolution at '${key}' = ${version} must be >= 0.9.12`).toBeGreaterThanOrEqual(
        0,
      );
    }
  });
});

describe("manifest <-> lockfile integrity (frozen-lock anti-bypass: no stale/hand-edited lockfile)", () => {
  interface PackageJsonShape {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }
  const rootPackageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as PackageJsonShape;
  const frontendPackageJson = JSON.parse(readFileSync(join(FRONTEND_DIR, "package.json"), "utf8")) as PackageJsonShape;

  function assertWorkspaceMatchesManifest(
    label: string,
    manifestSection: Record<string, string> | undefined,
    lockSection: Record<string, string> | undefined,
  ) {
    const manifestKeys = new Set(Object.keys(manifestSection ?? {}));
    const lockKeys = new Set(Object.keys(lockSection ?? {}));
    const onlyInManifest = [...manifestKeys].filter((k) => !lockKeys.has(k));
    const onlyInLock = [...lockKeys].filter((k) => !manifestKeys.has(k));
    expect(onlyInManifest, `${label}: keys present in package.json but missing from bun.lock's workspace block`).toEqual([]);
    expect(onlyInLock, `${label}: keys present in bun.lock's workspace block but missing from package.json`).toEqual([]);
    for (const key of manifestKeys) {
      expect(lockSection?.[key], `${label}['${key}']: bun.lock range must match package.json`).toBe(
        (manifestSection as Record<string, string>)[key],
      );
    }
  }

  test("root package.json dependencies exactly match bun.lock's workspace dependency ranges", () => {
    assertWorkspaceMatchesManifest("root dependencies", rootPackageJson.dependencies, rootLock.workspaces?.[""]?.dependencies);
  });

  test("root package.json devDependencies exactly match bun.lock's workspace devDependency ranges", () => {
    assertWorkspaceMatchesManifest(
      "root devDependencies",
      rootPackageJson.devDependencies,
      rootLock.workspaces?.[""]?.devDependencies,
    );
  });

  test("frontend package.json dependencies exactly match frontend/bun.lock's workspace dependency ranges", () => {
    assertWorkspaceMatchesManifest(
      "frontend dependencies",
      frontendPackageJson.dependencies,
      frontendLock.workspaces?.[""]?.dependencies,
    );
  });

  test("frontend package.json devDependencies exactly match frontend/bun.lock's workspace devDependency ranges", () => {
    assertWorkspaceMatchesManifest(
      "frontend devDependencies",
      frontendPackageJson.devDependencies,
      frontendLock.workspaces?.[""]?.devDependencies,
    );
  });
});

describe("frontend lock graph reflects the removed unused packages (requirement 3)", () => {
  test("frontend workspace no longer declares 'zod' or '@hookform/resolvers'", () => {
    const deps = frontendLock.workspaces?.[""]?.dependencies ?? {};
    expect(deps.zod).toBeUndefined();
    expect(deps["@hookform/resolvers"]).toBeUndefined();
  });
});

describe("anti-bypass: resolved packages are ordinary registry tarballs, not git/url substitutes (adversarial requirement)", () => {
  const SCOPED_PACKAGES = ["axios", "hono", "js-yaml", "mailparser", "@xmldom/xmldom", "form-data", "linkify-it", "nodemailer", "undici"];

  test("no in-scope package resolves to a git/http(s) source string instead of a registry version", () => {
    for (const pkg of SCOPED_PACKAGES) {
      for (const { key, version } of allResolutionsOf(rootLock, pkg)) {
        expect(/^(git|https?):/.test(version), `resolution at '${key}' must not be a git/url source: '${version}'`).toBe(false);
        expect(parseVersion(version), `resolution at '${key}' = '${version}' must be a parseable semver version`).not.toBeNull();
      }
    }
  });
});
