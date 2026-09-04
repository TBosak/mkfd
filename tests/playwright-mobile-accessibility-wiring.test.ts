import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the desktop+mobile Playwright project and accessibility-tooling
// contract from the `p1-dependency-ci-security-baseline` requirements brief,
// requirement 6: an explicit 390px mobile Chromium project alongside the
// existing desktop Chromium project, plus @axe-core/playwright wired in as a
// frontend devDependency.
//
// Reuses the same "load the real config in a fresh subprocess" technique the
// locked `tests/e2e-harness-config.test.ts` established for
// frontend/playwright.config.ts (a file this suite treats as read-only,
// consistent with that lock) - the resolved `use.viewport`/`use.isMobile`
// values only exist once Playwright's `devices[...]` presets are spread at
// import time, so this cannot be proven by grepping the source text alone.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");

interface ProjectShape {
  name?: string;
  use?: {
    viewport?: { width?: number; height?: number } | null;
    isMobile?: boolean;
    hasTouch?: boolean;
    defaultBrowserType?: string;
  };
  testIgnore?: string | string[];
  testMatch?: string | string[];
}

interface PlaywrightConfigShape {
  projects?: ProjectShape[];
  testIgnore?: string | string[];
  testMatch?: string | string[];
}

function loadPlaywrightConfig(): { exitCode: number; config: PlaywrightConfigShape | null; stderr: string } {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  const loaderCode =
    "import('./playwright.config.ts')" +
    ".then(m => { process.stdout.write(JSON.stringify({ config: m.default })); process.exit(0); })" +
    ".catch(e => { console.error(String((e && e.stack) || e)); process.exit(1); })";

  const proc = Bun.spawnSync({ cmd: ["bun", "-e", loaderCode], cwd: FRONTEND_DIR, env, stdout: "pipe", stderr: "pipe" });
  const stderr = proc.stderr.toString();
  const exitCode = proc.exitCode ?? 1;
  let config: PlaywrightConfigShape | null = null;
  if (exitCode === 0) {
    try {
      config = JSON.parse(proc.stdout.toString()).config ?? null;
    } catch {
      config = null;
    }
  }
  return { exitCode, config, stderr };
}

const { exitCode, config, stderr } = loadPlaywrightConfig();
const projects = config?.projects ?? [];

function isDesktopSized(project: ProjectShape): boolean {
  const width = project.use?.viewport?.width;
  return typeof width === "number" && width >= 1024;
}

function is390pxMobile(project: ProjectShape): boolean {
  return project.use?.viewport?.width === 390;
}

describe("frontend/playwright.config.ts loads successfully", () => {
  test("config module imports without throwing", () => {
    expect(exitCode, stderr).toBe(0);
    expect(config).not.toBeNull();
  });
});

describe("desktop Chromium project is retained (requirement 6, unchanged compatibility surface)", () => {
  test("at least one project resolves a desktop-sized viewport (width >= 1024px)", () => {
    expect(projects.some(isDesktopSized), JSON.stringify(projects)).toBe(true);
  });
});

describe("explicit 390px mobile Chromium project is added (requirement 6)", () => {
  test("at least one project resolves an exact 390px-wide viewport", () => {
    expect(projects.some(is390pxMobile), JSON.stringify(projects)).toBe(true);
  });

  test("the 390px project is a genuine mobile emulation (isMobile true), not a desktop project merely resized (anti-bypass)", () => {
    const mobileProject = projects.find(is390pxMobile);
    expect(mobileProject, "expected a project with viewport.width === 390").toBeDefined();
    expect(mobileProject?.use?.isMobile, JSON.stringify(mobileProject)).toBe(true);
  });

  test("the 390px project runs on the Chromium engine, not WebKit/Firefox (anti-bypass: must be 'mobile Chromium', not a Safari/iOS device preset)", () => {
    const mobileProject = projects.find(is390pxMobile);
    expect(mobileProject).toBeDefined();
    const engine = mobileProject?.use?.defaultBrowserType;
    if (engine !== undefined) {
      expect(engine, JSON.stringify(mobileProject)).toBe("chromium");
    }
  });

  test("the 390px mobile project and the desktop project are distinct, separately named projects (both retained simultaneously)", () => {
    const mobileProject = projects.find(is390pxMobile);
    const desktopProject = projects.find(isDesktopSized);
    expect(mobileProject).toBeDefined();
    expect(desktopProject).toBeDefined();
    expect(mobileProject?.name).not.toBe(desktopProject?.name);
  });

  test("at least two projects exist in total (desktop retained AND mobile added, not replaced)", () => {
    expect(projects.length).toBeGreaterThanOrEqual(2);
  });
});

describe("@axe-core/playwright is wired in as a frontend devDependency (requirement 6)", () => {
  const frontendPackageJson = JSON.parse(readFileSync(join(FRONTEND_DIR, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  test("frontend package.json declares '@axe-core/playwright' (as a dependency or devDependency)", () => {
    const range = frontendPackageJson.devDependencies?.["@axe-core/playwright"] ?? frontendPackageJson.dependencies?.["@axe-core/playwright"];
    expect(range, "expected '@axe-core/playwright' to be declared").toBeDefined();
    expect((range ?? "").length).toBeGreaterThan(0);
  });

  test("the declared range is not a git/url/npm-alias specifier", () => {
    const range = frontendPackageJson.devDependencies?.["@axe-core/playwright"] ?? frontendPackageJson.dependencies?.["@axe-core/playwright"];
    if (range === undefined) return; // covered by the dedicated "is declared" test above
    expect(/^(npm:|git\+|git:|github:|https?:\/\/|file:|link:|workspace:)/.test(range)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gap 3, config side (lead review): a CI step can run every configured
// project without any `--project`/`--grep` narrowing (see the CI-side check
// in `ci-quality-workflow.test.ts`) and the accessibility spec could still
// never run if the *config itself* excludes it via `testIgnore`/`testMatch`,
// at either the top level or on a specific project (e.g. the new 390px
// mobile project narrowing itself to a subset of specs that quietly drops
// `accessibility.spec.ts`).
// ---------------------------------------------------------------------------

/**
 * Minimal glob-to-RegExp translator sufficient for Playwright's
 * testIgnore/testMatch glob strings: a globstar-slash prefix optionally
 * matches any number of leading path segments (so a pattern like
 * "globstar/accessibility.spec.ts" matches both "accessibility.spec.ts" and
 * "e2e/accessibility.spec.ts", matching real glob-engine semantics rather
 * than requiring a literal leading separator), a bare globstar elsewhere
 * matches across path separators, a single star matches within one segment,
 * and "?" matches one character. Regex-special characters are escaped first
 * (this never touches the wildcard markers), then every wildcard token is
 * translated in one left-to-right pass via a single alternation regex - not
 * several sequential replace calls - so a substitution's own output (e.g.
 * the star inside the inserted "any-depth" group) is never re-scanned by a
 * later substitution step.
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*\*\/|\*\*|\*|\?/g, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    return "."; // "?"
  });
  return new RegExp(`^${pattern}$`);
}

function specIsIgnored(specFileName: string, testIgnore: string | string[] | undefined): boolean {
  if (!testIgnore) return false;
  const patterns = Array.isArray(testIgnore) ? testIgnore : [testIgnore];
  return patterns.some((p) => globToRegExp(p).test(specFileName));
}

/** `testMatch`, when set, replaces Playwright's default broad match pattern - so a spec not matching ANY listed pattern is excluded. An undefined/absent `testMatch` matches everything (Playwright's default), not nothing. */
function specIsExcludedByTestMatch(specFileName: string, testMatch: string | string[] | undefined): boolean {
  if (!testMatch) return false;
  const patterns = Array.isArray(testMatch) ? testMatch : [testMatch];
  return !patterns.some((p) => globToRegExp(p).test(specFileName));
}

describe("globToRegExp / specIsIgnored / specIsExcludedByTestMatch helper correctness", () => {
  test("a globstar testIgnore glob matches the spec regardless of directory depth", () => {
    expect(specIsIgnored("accessibility.spec.ts", "**/accessibility.spec.ts")).toBe(true);
    expect(specIsIgnored("e2e/accessibility.spec.ts", "**/accessibility.spec.ts")).toBe(true);
    expect(specIsIgnored("a/b/accessibility.spec.ts", "**/accessibility.spec.ts")).toBe(true);
  });

  test("an unrelated testIgnore glob does not match the accessibility spec", () => {
    expect(specIsIgnored("accessibility.spec.ts", "**/legacy/*.spec.ts")).toBe(false);
  });

  test("no testIgnore at all means nothing is ignored", () => {
    expect(specIsIgnored("accessibility.spec.ts", undefined)).toBe(false);
  });

  test("a testMatch that only lists other specs excludes the accessibility spec", () => {
    expect(specIsExcludedByTestMatch("accessibility.spec.ts", ["**/basic.spec.ts", "**/feeds.spec.ts"])).toBe(true);
  });

  test("a testMatch that includes the accessibility spec does not exclude it", () => {
    expect(specIsExcludedByTestMatch("accessibility.spec.ts", ["**/*.spec.ts"])).toBe(false);
  });

  test("no testMatch at all means nothing is excluded (Playwright's default broad match applies)", () => {
    expect(specIsExcludedByTestMatch("accessibility.spec.ts", undefined)).toBe(false);
  });
});

describe("the accessibility spec is not excluded by testIgnore/testMatch, at the config or project level (requirement 6, gap 3)", () => {
  const ACCESSIBILITY_SPEC = "accessibility.spec.ts";

  test("the top-level config does not ignore or test-match-exclude the accessibility spec", () => {
    expect(exitCode, stderr).toBe(0);
    expect(specIsIgnored(ACCESSIBILITY_SPEC, config?.testIgnore), JSON.stringify(config?.testIgnore)).toBe(false);
    expect(specIsExcludedByTestMatch(ACCESSIBILITY_SPEC, config?.testMatch), JSON.stringify(config?.testMatch)).toBe(false);
  });

  test("no individual project ignores or test-match-excludes the accessibility spec", () => {
    expect(exitCode, stderr).toBe(0);
    const offenders = projects.filter(
      (p) => specIsIgnored(ACCESSIBILITY_SPEC, p.testIgnore) || specIsExcludedByTestMatch(ACCESSIBILITY_SPEC, p.testMatch),
    );
    expect(offenders.map((p) => p.name), JSON.stringify(offenders)).toEqual([]);
  });
});
