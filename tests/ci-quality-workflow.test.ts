import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Specifies the primary pull-request quality-gate workflow contract from the
// `p1-dependency-ci-security-baseline` requirements brief, requirement 5:
// a workflow triggered on PRs (and relevant branch pushes) that installs
// from the frozen root+frontend lockfiles and runs lint, all typechecks,
// backend unit/integration tests, catalog validation, production build, and
// Playwright - on BOTH ubuntu-latest and windows-latest.
//
// This suite parses the real YAML structure (via js-yaml, already a root
// dependency) and validates *effective* jobs/steps rather than grepping
// text, per the brief's explicit anti-bypass instruction. In particular it
// never trusts a `strategy.matrix.os` declaration at face value: it resolves
// each job's *actual* `runs-on` value(s), expanding a `${{ matrix.<key> }}`
// reference against the matrix that defines it, so a matrix axis that is
// declared but never consumed by `runs-on` correctly resolves to nothing.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

interface StepShape {
  run?: string;
  uses?: string;
  "working-directory"?: string;
  "continue-on-error"?: boolean | string;
  shell?: string;
  with?: Record<string, unknown>;
}

interface JobShape {
  "runs-on"?: string | string[];
  strategy?: { matrix?: Record<string, unknown> };
  steps?: StepShape[];
  permissions?: unknown;
  "continue-on-error"?: boolean | string;
  if?: unknown;
}

interface WorkflowDoc {
  on?: unknown;
  jobs?: Record<string, JobShape>;
  permissions?: unknown;
}

interface LoadedWorkflow {
  file: string;
  path: string;
  text: string;
  doc: WorkflowDoc | null;
}

function loadWorkflows(): LoadedWorkflow[] {
  let files: string[] = [];
  try {
    files = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    files = [];
  }
  return files.map((file) => {
    const path = join(WORKFLOWS_DIR, file);
    const text = readFileSync(path, "utf8");
    let doc: WorkflowDoc | null = null;
    try {
      doc = yaml.load(text) as WorkflowDoc;
    } catch {
      doc = null;
    }
    return { file, path, text, doc };
  });
}

const workflows = loadWorkflows();

/** Extracts the `matrix.<key>` name a runs-on string references, or null if it is a plain literal. */
function matrixKeyFromRunsOn(runsOn: string): string | null {
  const match = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/.exec(runsOn);
  return match ? match[1] : null;
}

/** All concrete values a matrix axis can take, combining the direct array form and any `matrix.include` entries that set the same key. */
function matrixValuesForKey(matrix: Record<string, unknown> | undefined, key: string): string[] {
  if (!matrix) return [];
  const direct = Array.isArray(matrix[key]) ? (matrix[key] as unknown[]).map(String) : [];
  const includeEntries = Array.isArray(matrix.include) ? (matrix.include as Array<Record<string, unknown>>) : [];
  const fromInclude = includeEntries.map((entry) => entry[key]).filter((v): v is string => typeof v === "string");
  return [...new Set([...direct, ...fromInclude])];
}

/**
 * The concrete `runs-on` label(s) a job actually executes on. A literal
 * string/array passes through unchanged. A `${{ matrix.<key> }}` reference
 * resolves against `job.strategy.matrix`; if that key is not actually
 * defined in the matrix, this deliberately returns `[]` - the job does not
 * genuinely run on any OS as far as this test suite can prove, which is
 * exactly the "declared matrix, unconsumed runs-on" anti-bypass case.
 */
function resolveEffectiveRunsOn(job: JobShape): string[] {
  const runsOn = job["runs-on"];
  if (Array.isArray(runsOn)) return runsOn;
  if (typeof runsOn !== "string") return [];
  const key = matrixKeyFromRunsOn(runsOn);
  if (!key) return [runsOn];
  return matrixValuesForKey(job.strategy?.matrix, key);
}

function stepsOf(job: JobShape): StepShape[] {
  return job.steps ?? [];
}

function stepMatches(step: StepShape, pattern: RegExp): boolean {
  return (!!step.run && pattern.test(step.run)) || (!!step.uses && pattern.test(step.uses));
}

function stepIsFrontendScoped(step: StepShape): boolean {
  const wd = step["working-directory"] ?? "";
  return /frontend/i.test(wd) || (!!step.run && /\bfrontend\//.test(step.run));
}

function hasFrozenInstall(steps: StepShape[], scope: "root" | "frontend"): boolean {
  return steps.some((step) => {
    if (!step.run) return false;
    if (!/\bbun\s+install\b/.test(step.run) || !/--frozen-lockfile/.test(step.run)) return false;
    return scope === "frontend" ? stepIsFrontendScoped(step) : !stepIsFrontendScoped(step);
  });
}

// A literal GitHub Actions expression, not a JS template placeholder - biome's
// noTemplateCurlyInString would otherwise (mis)suggest turning this into a
// real template literal, which would break the intentionally-literal `${{ }}`
// text these fixtures need to resolve against.
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression syntax, not JS interpolation
const MATRIX_OS_REF = "${{ matrix.os }}";

describe("matrix/runs-on resolution helper correctness (anti-bypass for deceptive matrices)", () => {
  test("a job whose runs-on hardcodes a literal ignores an unrelated declared matrix axis", () => {
    const job: JobShape = {
      "runs-on": "ubuntu-latest",
      strategy: { matrix: { os: ["ubuntu-latest", "windows-latest"] } },
    };
    expect(resolveEffectiveRunsOn(job)).toEqual(["ubuntu-latest"]);
  });

  test("a job whose runs-on genuinely consumes matrix.os resolves to every declared value", () => {
    const job: JobShape = {
      "runs-on": MATRIX_OS_REF,
      strategy: { matrix: { os: ["ubuntu-latest", "windows-latest"] } },
    };
    expect(resolveEffectiveRunsOn(job).sort()).toEqual(["ubuntu-latest", "windows-latest"]);
  });

  test("a runs-on matrix reference with no matching matrix key resolves to no OS at all", () => {
    const job: JobShape = {
      "runs-on": MATRIX_OS_REF,
      strategy: { matrix: { node: [18, 20] } },
    };
    expect(resolveEffectiveRunsOn(job)).toEqual([]);
  });

  test("matrix.include entries contribute additional values for the same key", () => {
    const job: JobShape = {
      "runs-on": MATRIX_OS_REF,
      strategy: { matrix: { include: [{ os: "ubuntu-latest" }, { os: "windows-latest" }] } },
    };
    expect(resolveEffectiveRunsOn(job).sort()).toEqual(["ubuntu-latest", "windows-latest"]);
  });
});

describe("hasFrozenInstall helper correctness (anti-bypass for missing --frozen-lockfile)", () => {
  test("flags a bare 'bun install' with no --frozen-lockfile as not frozen", () => {
    expect(hasFrozenInstall([{ run: "bun install" }], "root")).toBe(false);
  });

  test("accepts 'bun install --frozen-lockfile' for the root scope", () => {
    expect(hasFrozenInstall([{ run: "bun install --frozen-lockfile" }], "root")).toBe(true);
  });

  test("distinguishes a frontend-scoped frozen install (via working-directory) from a root one", () => {
    const steps: StepShape[] = [{ run: "bun install --frozen-lockfile", "working-directory": "frontend" }];
    expect(hasFrozenInstall(steps, "frontend")).toBe(true);
    expect(hasFrozenInstall(steps, "root")).toBe(false);
  });
});

/**
 * For a given OS label, the aggregated steps of every job in `doc` whose
 * effective runs-on set includes that label. Using this (rather than "any
 * job anywhere") is what proves the *complete* gate runs on that OS, not
 * merely that some job happens to run on it.
 */
function stepsForOs(doc: WorkflowDoc, osLabel: string): StepShape[] {
  const jobs = Object.values(doc.jobs ?? {});
  return jobs.filter((job) => resolveEffectiveRunsOn(job).includes(osLabel)).flatMap(stepsOf);
}

const REQUIRED_GATE_CHECKS: Array<[label: string, pattern: RegExp]> = [
  ["lint", /\bbun run lint\b/],
  ["typecheck", /\bbun run typecheck\b/],
  ["backend unit/integration tests", /\bbun run test\b(?!:)/],
  ["catalog validation", /validate:catalog/],
  ["production build", /\bbun run build\b/],
  ["Playwright", /playwright test|test:e2e/],
];

function findPrimaryQualityWorkflow(): LoadedWorkflow | undefined {
  return workflows.find((wf) => {
    if (!wf.doc?.jobs) return false;
    for (const osLabel of ["ubuntu-latest", "windows-latest"]) {
      const steps = stepsForOs(wf.doc, osLabel);
      if (steps.length === 0) return false;
      const rootFrozen = hasFrozenInstall(steps, "root");
      const frontendFrozen = hasFrozenInstall(steps, "frontend");
      if (!rootFrozen || !frontendFrozen) return false;
      for (const [, pattern] of REQUIRED_GATE_CHECKS) {
        if (!steps.some((s) => stepMatches(s, pattern))) return false;
      }
    }
    return true;
  });
}

const primaryWorkflow = findPrimaryQualityWorkflow();

describe("a primary PR quality workflow exists and triggers on pull requests and branch pushes (requirement 5)", () => {
  test("at least one workflow under .github/workflows resolves as the complete dual-OS quality gate", () => {
    expect(
      primaryWorkflow,
      "no workflow was found where BOTH ubuntu-latest and windows-latest jobs run frozen root+frontend installs, lint, typecheck, backend tests, catalog validation, build, and Playwright",
    ).toBeDefined();
  });

  test("that workflow triggers on pull_request", () => {
    expect(primaryWorkflow).toBeDefined();
    const on = primaryWorkflow?.doc?.on;
    const hasPullRequest = typeof on === "object" && on !== null && "pull_request" in (on as object);
    expect(hasPullRequest, `'on' must include pull_request; got: ${JSON.stringify(on)}`).toBe(true);
  });

  test("that workflow also triggers on a relevant branch push", () => {
    expect(primaryWorkflow).toBeDefined();
    const on = primaryWorkflow?.doc?.on;
    const hasPush = typeof on === "object" && on !== null && "push" in (on as object);
    expect(hasPush, `'on' must include push; got: ${JSON.stringify(on)}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gap 2 (lead review): passing every step-pattern/matrix check above is not
// enough if the workflow simply never *runs* for an ordinary pull request -
// either because a job-level `if:` excludes the pull_request event, or
// because `on.pull_request` itself is narrowed with a `branches:` allowlist
// or a `paths`/`paths-ignore` filter that would skip ordinary source
// changes. Both are structural checks on the parsed YAML, not text greps.
// ---------------------------------------------------------------------------

/**
 * True when a job-level `if:` condition would exclude the `pull_request`
 * event - either an explicit `!= 'pull_request'`, or an `== '<other-event>'`
 * comparison with no `pull_request` alternative anywhere in the expression
 * (so an OR'd `event_name == 'push' || event_name == 'pull_request'` is
 * correctly treated as inclusive, not excluding).
 */
function jobConditionExcludesPullRequest(condition: unknown): boolean {
  const text = String(condition ?? "").trim();
  if (!text) return false;
  if (/event_name\s*!=\s*['"]pull_request['"]/.test(text)) return true;
  const equalsOtherEvent = /event_name\s*==\s*['"](\w+)['"]/.exec(text);
  if (equalsOtherEvent && equalsOtherEvent[1] !== "pull_request" && !/pull_request/.test(text)) return true;
  return false;
}

/** True when `on.pull_request` is either absent-of-filters (bare key / empty object) - i.e. runs for every ordinary PR - and false when it carries a `branches` allowlist or a `paths`/`paths-ignore` filter that could exclude ordinary source changes. */
function pullRequestTriggerIsUnrestricted(on: unknown): boolean {
  if (typeof on !== "object" || on === null) return false;
  const pr = (on as Record<string, unknown>).pull_request;
  if (pr === null || pr === undefined) return true;
  if (typeof pr !== "object") return true;
  const prObj = pr as Record<string, unknown>;
  if ("branches" in prObj) return false;
  if ("paths" in prObj || "paths-ignore" in prObj) return false;
  return true;
}

describe("jobConditionExcludesPullRequest / pullRequestTriggerIsUnrestricted helper correctness", () => {
  test("flags an if: condition restricted to a non-PR event", () => {
    expect(jobConditionExcludesPullRequest("github.event_name == 'push'")).toBe(true);
  });

  test("flags an if: condition that explicitly excludes pull_request", () => {
    expect(jobConditionExcludesPullRequest("github.event_name != 'pull_request'")).toBe(true);
  });

  test("does not flag an if: condition that explicitly includes pull_request", () => {
    expect(jobConditionExcludesPullRequest("github.event_name == 'pull_request'")).toBe(false);
  });

  test("does not flag an OR'd condition that still includes pull_request as one branch", () => {
    expect(jobConditionExcludesPullRequest("github.event_name == 'push' || github.event_name == 'pull_request'")).toBe(false);
  });

  test("does not flag an empty/absent condition", () => {
    expect(jobConditionExcludesPullRequest(undefined)).toBe(false);
    expect(jobConditionExcludesPullRequest("")).toBe(false);
  });

  test("treats a bare (filter-less) pull_request trigger as unrestricted", () => {
    expect(pullRequestTriggerIsUnrestricted({ pull_request: null, push: { branches: ["main"] } })).toBe(true);
    expect(pullRequestTriggerIsUnrestricted({ pull_request: {} })).toBe(true);
  });

  test("flags a pull_request trigger narrowed by a branches allowlist", () => {
    expect(pullRequestTriggerIsUnrestricted({ pull_request: { branches: ["release/**"] } })).toBe(false);
  });

  test("flags a pull_request trigger narrowed by paths or paths-ignore", () => {
    expect(pullRequestTriggerIsUnrestricted({ pull_request: { paths: ["src/**"] } })).toBe(false);
    expect(pullRequestTriggerIsUnrestricted({ pull_request: { "paths-ignore": ["docs/**"] } })).toBe(false);
  });
});

describe("the primary quality workflow actually runs for ordinary pull requests (requirement 5 anti-bypass, gap 2)", () => {
  test("on.pull_request is not restricted by a branches allowlist or a paths/paths-ignore filter", () => {
    expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
    expect(
      pullRequestTriggerIsUnrestricted(primaryWorkflow?.doc?.on),
      `'on.pull_request' must not be narrowed away from ordinary source changes; got: ${JSON.stringify(primaryWorkflow?.doc?.on)}`,
    ).toBe(true);
  });

  test("no job contributing a required gate step carries an if: condition that excludes pull_request", () => {
    expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
    const jobs = Object.entries(primaryWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const [jobName, job] of jobs) {
      const runsOnSomeGateOs = ["ubuntu-latest", "windows-latest"].some((os) => resolveEffectiveRunsOn(job).includes(os));
      if (!runsOnSomeGateOs) continue;
      if (jobConditionExcludesPullRequest(job.if)) offenders.push(`${jobName}: if: '${String(job.if)}'`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("per-required-check coverage on both OS (requirement 5, granular failure diagnostics)", () => {
  for (const osLabel of ["ubuntu-latest", "windows-latest"]) {
    for (const [label, pattern] of REQUIRED_GATE_CHECKS) {
      test(`${osLabel} job(s) in the primary quality workflow run '${label}'`, () => {
        expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
        const doc = primaryWorkflow?.doc;
        const steps = doc ? stepsForOs(doc, osLabel) : [];
        expect(steps.some((s) => stepMatches(s, pattern)), `expected a step matching ${pattern} on ${osLabel}`).toBe(true);
      });
    }

    test(`${osLabel} job(s) in the primary quality workflow install both root and frontend graphs from the frozen lockfile`, () => {
      expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
      const doc = primaryWorkflow?.doc;
      const steps = doc ? stepsForOs(doc, osLabel) : [];
      expect(hasFrozenInstall(steps, "root"), `expected a root frozen install on ${osLabel}`).toBe(true);
      expect(hasFrozenInstall(steps, "frontend"), `expected a frontend frozen install on ${osLabel}`).toBe(true);
    });

    test(`${osLabel} job(s) install Playwright browsers (must not silently skip browser installation on either OS)`, () => {
      expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
      const doc = primaryWorkflow?.doc;
      const steps = doc ? stepsForOs(doc, osLabel) : [];
      expect(steps.some((s) => stepMatches(s, /playwright install|patchright install/i)), `expected a browser install step on ${osLabel}`).toBe(
        true,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Gap 3, CI side (lead review): matching `/playwright test|test:e2e/` proves
// *a* Playwright invocation exists, but a step can add `--project`,
// `--grep`/`--grep-invert`, `--ignore`, or `--shard` flags that silently drop
// the 390px mobile project or the accessibility spec while still matching
// that pattern. This loads the real configured project names from
// `frontend/playwright.config.ts` (the same subprocess-loader technique used
// in `playwright-mobile-accessibility-wiring.test.ts`) so "every project is
// explicitly named" can be checked against the *actual* config, not a
// hardcoded guess at project names.
// ---------------------------------------------------------------------------

function loadPlaywrightProjectNames(): string[] {
  const frontendDir = join(REPO_ROOT, "frontend");
  const loaderCode =
    "import('./playwright.config.ts')" +
    ".then(m => { process.stdout.write(JSON.stringify((m.default.projects ?? []).map(p => p.name))); process.exit(0); })" +
    ".catch(e => { console.error(String((e && e.stack) || e)); process.exit(1); })";
  const proc = Bun.spawnSync({ cmd: ["bun", "-e", loaderCode], cwd: frontendDir, stdout: "pipe", stderr: "pipe" });
  if ((proc.exitCode ?? 1) !== 0) return [];
  try {
    return JSON.parse(proc.stdout.toString());
  } catch {
    return [];
  }
}

/**
 * True when a Playwright CLI invocation narrows the run enough that it could
 * skip a configured project (e.g. the 390px mobile project) or a spec file
 * (e.g. `accessibility.spec.ts`): any `--grep`, `--grep-invert`, `--ignore`,
 * or `--shard` flag is an unconditional narrowing; a `--project` flag only
 * narrows when it does not name every project in `allProjectNames`.
 */
function playwrightStepNarrowsCoverage(run: string, allProjectNames: string[]): boolean {
  if (/--grep-invert\b/.test(run)) return true;
  if (/--grep\b/.test(run)) return true;
  if (/--ignore\b/.test(run)) return true;
  if (/--shard\b/.test(run)) return true;
  const projectFlags = [...run.matchAll(/--project[= ]("[^"]+"|'[^']+'|\S+)/g)].map((m) => m[1].replace(/^["']|["']$/g, ""));
  if (projectFlags.length === 0) return false;
  if (allProjectNames.length === 0) return true; // can't prove full coverage without a known project list
  const namedSet = new Set(projectFlags);
  return !allProjectNames.every((name) => namedSet.has(name));
}

describe("playwrightStepNarrowsCoverage helper correctness", () => {
  const PROJECTS = ["chromium-desktop", "chromium-mobile-390"];

  test("an unfiltered invocation does not narrow coverage", () => {
    expect(playwrightStepNarrowsCoverage("bun run test:e2e", PROJECTS)).toBe(false);
    expect(playwrightStepNarrowsCoverage("playwright test", PROJECTS)).toBe(false);
  });

  test("--grep-invert, --grep, --ignore, and --shard each narrow coverage", () => {
    expect(playwrightStepNarrowsCoverage("playwright test --grep-invert=Accessibility", PROJECTS)).toBe(true);
    expect(playwrightStepNarrowsCoverage("playwright test --grep=@smoke", PROJECTS)).toBe(true);
    expect(playwrightStepNarrowsCoverage("playwright test --ignore=**/accessibility.spec.ts", PROJECTS)).toBe(true);
    expect(playwrightStepNarrowsCoverage("playwright test --shard=1/2", PROJECTS)).toBe(true);
  });

  test("--project naming only some configured projects narrows coverage", () => {
    expect(playwrightStepNarrowsCoverage("playwright test --project=chromium-desktop", PROJECTS)).toBe(true);
  });

  test("--project naming every configured project does not narrow coverage", () => {
    expect(
      playwrightStepNarrowsCoverage("playwright test --project=chromium-desktop --project=chromium-mobile-390", PROJECTS),
    ).toBe(false);
  });
});

describe("Playwright step(s) on both OS do not silently narrow away the mobile project or accessibility spec (requirement 5 + 6, gap 3)", () => {
  const projectNames = loadPlaywrightProjectNames();

  test("sanity check: the real config's project names were loaded successfully", () => {
    expect(projectNames.length, "expected at least one Playwright project name from frontend/playwright.config.ts").toBeGreaterThan(0);
  });

  for (const osLabel of ["ubuntu-latest", "windows-latest"]) {
    test(`${osLabel} Playwright step(s) do not narrow coverage away from any configured project or spec`, () => {
      expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
      const doc = primaryWorkflow?.doc;
      const steps = doc ? stepsForOs(doc, osLabel) : [];
      const playwrightSteps = steps.filter((s) => s.run && /playwright test|test:e2e/.test(s.run));
      expect(playwrightSteps.length, `expected a Playwright step on ${osLabel}`).toBeGreaterThan(0);
      const offenders = playwrightSteps.filter((s) => playwrightStepNarrowsCoverage(s.run ?? "", projectNames));
      expect(offenders.map((s) => s.run), offenders.map((s) => s.run).join("\n")).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Gap 6 (lead review): a Windows job can match every step-pattern assertion
// above while still being POSIX-only and therefore broken on the actual
// windows-latest runner - the exact defect class the accepted
// `p1-cross-platform-e2e-launch` slice already fixed once for the Playwright
// launcher itself. Skips steps that declare an explicit POSIX `shell:`
// (their author has opted into bash/sh semantics, which Windows runners do
// provide via Git Bash), matching the brief's "does not declare an explicit
// POSIX shell:" carve-out.
// ---------------------------------------------------------------------------

function usesPosixOnlyConstruct(run: string): boolean {
  if (/\bexport\s+\w+=/.test(run)) return true;
  if (/\$\([^)]*\)/.test(run)) return true;
  if (/<<[-~]?['"]?\w+['"]?/.test(run)) return true;
  if (/\brm\s+-rf\b/.test(run)) return true;
  if (/2>\/dev\/null\b/.test(run)) return true;
  return false;
}

function stepDeclaresPosixShell(step: StepShape): boolean {
  return step.shell === "bash" || step.shell === "sh";
}

describe("usesPosixOnlyConstruct / stepDeclaresPosixShell helper correctness", () => {
  test("flags export VAR=, $(...) command substitution, heredocs, rm -rf, and 2>/dev/null", () => {
    expect(usesPosixOnlyConstruct("export CI=1 && bun run test")).toBe(true);
    expect(usesPosixOnlyConstruct('VERSION=$(node -p "require(\'./package.json\').version")')).toBe(true);
    expect(usesPosixOnlyConstruct("cat <<EOF\nhello\nEOF")).toBe(true);
    expect(usesPosixOnlyConstruct("rm -rf dist")).toBe(true);
    expect(usesPosixOnlyConstruct("bun run lint 2>/dev/null")).toBe(true);
  });

  test("does not flag a plain, portable bun invocation", () => {
    expect(usesPosixOnlyConstruct("bun run lint")).toBe(false);
    expect(usesPosixOnlyConstruct("bun install --frozen-lockfile")).toBe(false);
  });

  test(`does not false-positive on a GitHub Actions ${MATRIX_OS_REF} expression (no literal '$(' present)`, () => {
    expect(usesPosixOnlyConstruct(`bun run build -- ${MATRIX_OS_REF}`)).toBe(false);
  });

  test("stepDeclaresPosixShell recognizes an explicit bash/sh opt-in and rejects everything else", () => {
    expect(stepDeclaresPosixShell({ shell: "bash" })).toBe(true);
    expect(stepDeclaresPosixShell({ shell: "sh" })).toBe(true);
    expect(stepDeclaresPosixShell({ shell: "pwsh" })).toBe(false);
    expect(stepDeclaresPosixShell({})).toBe(false);
  });
});

describe("windows-latest steps avoid POSIX-only shell constructs (requirement 5, gap 6)", () => {
  test("no windows-latest step (without an explicit bash/sh shell:) uses an export/$()/heredoc/rm -rf/2>/dev/null construct", () => {
    expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
    const doc = primaryWorkflow?.doc;
    const steps = doc ? stepsForOs(doc, "windows-latest") : [];
    const offenders = steps.filter((s) => !!s.run && !stepDeclaresPosixShell(s) && usesPosixOnlyConstruct(s.run));
    expect(offenders.map((s) => s.run), offenders.map((s) => s.run).join("\n")).toEqual([]);
  });
});

describe("primary quality workflow does not mask failures (requirement 5 + 7 shared anti-bypass)", () => {
  test("no job or step in the primary quality workflow sets continue-on-error", () => {
    expect(primaryWorkflow, "primary quality workflow must exist").toBeDefined();
    const jobs = Object.entries(primaryWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const [jobName, job] of jobs) {
      if (job["continue-on-error"]) offenders.push(`job:${jobName}`);
      for (const [i, step] of stepsOf(job).entries()) {
        if (step["continue-on-error"]) offenders.push(`job:${jobName} step:${i}`);
      }
    }
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});

describe("cache keys, if used, include lockfile integrity and never target credential paths (requirement 8)", () => {
  test("every actions/cache step's key hashes a bun lockfile, and its cached path is not a credential-looking directory", () => {
    for (const wf of workflows) {
      for (const job of Object.values(wf.doc?.jobs ?? {})) {
        for (const step of stepsOf(job)) {
          if (!step.uses || !/actions\/cache/.test(step.uses)) continue;
          const key = String(step.with?.key ?? "");
          expect(/hashFiles\([^)]*bun\.lock[^)]*\)/.test(key), `${wf.file}: cache key must hashFiles(...bun.lock...): '${key}'`).toBe(
            true,
          );
          const path = step.with?.path;
          const pathText = Array.isArray(path) ? path.join(" ") : String(path ?? "");
          expect(
            /(credential|secrets?\/|\.env\b|\.aws\b|\.ssh\b)/i.test(pathText),
            `${wf.file}: cache path must not target a credential-looking location: '${pathText}'`,
          ).toBe(false);
        }
      }
    }
  });
});
