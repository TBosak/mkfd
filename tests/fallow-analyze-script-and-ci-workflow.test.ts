import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Specifies the `p1-fallow-static-analysis-gate` requirements brief
// (Packet 1 follow-up), requirement 4, AS SUPERSEDED BY AMENDMENT 1:
//
//   A. The CI gate judges CHANGED code only, via `fallow audit` (new-only
//      attribution by default) - the pre-existing backlog never blocks a PR,
//      new debt is stopped at the door. `bun run analyze` remains the
//      full-pipeline LOCAL command and must keep using a flag that GENUINELY
//      fails on findings.
//
// Exit code 2 (tool error) must fail the job and stay distinguishable from
// exit code 1 (findings) - i.e. no construct may collapse both into one
// hardcoded status. This file no longer asserts "the gate is green" for
// `bun run analyze` (former requirement 7): Amendment 1 explicitly leaves
// the ~300-finding full-pipeline backlog (health/dupes especially) unfixed
// by this slice, so the full pipeline is not expected to reach exit 0 here.
//
// Follows the real-YAML-parsing technique already used by
// tests/ci-quality-workflow.test.ts and tests/ci-supply-chain-workflow.test.ts
// (js-yaml, already a root dependency) rather than grepping workflow text.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const EXEC_TIMEOUT_MS = 30_000;

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

function readPackageJson(): PackageJsonShape {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as PackageJsonShape;
}

// ---------------------------------------------------------------------------
// shared anti-bypass helpers: a construct that discards/normalizes a real
// exit code, and a flag that would compare against a saved backlog snapshot
// instead of the exceptions document.
// ---------------------------------------------------------------------------

function collapsesOrDiscardsExitCode(command: string): boolean {
  if (/\|\|\s*true\b/.test(command)) return true;
  if (/;\s*exit\s+0\b/.test(command)) return true;
  if (/&&\s*exit\s+0\b/.test(command)) return true;
  if (/\|\|\s*exit\s+\d/.test(command)) return true; // forces one fixed code regardless of the real one
  if (/2>\s*\/dev\/null/.test(command)) return true;
  if (/>\s*\/dev\/null\s+2>&1/.test(command)) return true;
  if (/continue-on-error/.test(command)) return true;
  return false;
}

function referencesSavedBaselineSnapshot(command: string): boolean {
  if (/--save-baseline\b/.test(command)) return true;
  if (/--save-regression-baseline\b/.test(command)) return true;
  if (/--fail-on-regression\b/.test(command)) return true;
  if (/--baseline(?!-mode)\b/.test(command)) return true;
  return false;
}

describe("collapsesOrDiscardsExitCode / referencesSavedBaselineSnapshot helper correctness", () => {
  test("flags '|| true', '; exit 0', '&& exit 0', a forced '|| exit N', 2>/dev/null, and continue-on-error", () => {
    expect(collapsesOrDiscardsExitCode("bun run analyze || true")).toBe(true);
    expect(collapsesOrDiscardsExitCode("bun run analyze; exit 0")).toBe(true);
    expect(collapsesOrDiscardsExitCode("bun run analyze && exit 0")).toBe(true);
    expect(collapsesOrDiscardsExitCode("bun run analyze || exit 1")).toBe(true);
    expect(collapsesOrDiscardsExitCode("bun run analyze 2>/dev/null")).toBe(true);
    expect(collapsesOrDiscardsExitCode("continue-on-error: true")).toBe(true);
  });

  test("does not flag a plain, unmodified invocation", () => {
    expect(collapsesOrDiscardsExitCode("bun run analyze")).toBe(false);
    expect(collapsesOrDiscardsExitCode("fallow audit")).toBe(false);
  });

  test("referencesSavedBaselineSnapshot flags --baseline, --save-baseline, --save-regression-baseline, --fail-on-regression", () => {
    expect(referencesSavedBaselineSnapshot("fallow --baseline .fallow/baseline.json")).toBe(true);
    expect(referencesSavedBaselineSnapshot("fallow --save-baseline")).toBe(true);
    expect(referencesSavedBaselineSnapshot("fallow --save-regression-baseline")).toBe(true);
    expect(referencesSavedBaselineSnapshot("fallow --fail-on-regression")).toBe(true);
  });

  test("referencesSavedBaselineSnapshot does not flag the unrelated --baseline-mode flag", () => {
    expect(referencesSavedBaselineSnapshot("fallow --baseline-mode count")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lead review gap 2: `fallow --ci` is documented as equivalent to
// `--format sarif --fail-on-issues --quiet`, but measured exiting 0 with
// findings present. This suite does not trust that documentation - it
// spawns the real pinned binary against THIS repo's own current backlog
// (a real fixture with a definite finding, not a synthetic one) and proves
// empirically which flag actually gates. The result is cached at module
// scope and reused by every test below that needs it, satisfying "reuse a
// single fallow invocation per test process" for this file's real spawns.
// ---------------------------------------------------------------------------

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

function runFallow(args: string[]): FallowRunResult {
  const key = JSON.stringify(args);
  const cached = fallowRunCache.get(key);
  if (cached) return cached;
  const bin = localFallowBinPath();
  expect(existsSync(bin), `no local fallow binary found at ${bin}`).toBe(true);
  const proc = Bun.spawnSync({ cmd: [bin, ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  const result: FallowRunResult = { exit: proc.exitCode ?? 1, out: proc.stdout.toString(), err: proc.stderr.toString() };
  fallowRunCache.set(key, result);
  return result;
}

function currentFindingsPresent(): boolean {
  const { out } = runFallow(["--format", "json", "--quiet"]);
  const data = JSON.parse(out) as { check?: { total_issues?: number } };
  return (data.check?.total_issues ?? 0) > 0;
}

describe("empirical proof (not documentation) of which flag genuinely gates on findings (gap 2)", () => {
  test(
    "sanity: this repo currently has at least one real finding, so the flags below are being proven against a genuine fixture",
    () => {
      expect(currentFindingsPresent(), "expected at least one real fallow finding in the current repo to test against").toBe(true);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "'--fail-on-issues' exits non-zero when findings are present",
    () => {
      expect(currentFindingsPresent()).toBe(true);
      const { exit } = runFallow(["--fail-on-issues", "--quiet"]);
      expect(exit, "--fail-on-issues must exit non-zero when findings exist").not.toBe(0);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "'--ci' does NOT reliably exit non-zero when findings are present (measured, not assumed from its documentation) - this is why it must not be accepted as the gate flag",
    () => {
      expect(currentFindingsPresent()).toBe(true);
      const { exit } = runFallow(["--ci"]);
      expect(
        exit,
        "this documents the measured (surprising) behavior driving the requirement below: --ci must not be trusted to gate",
      ).toBe(0);
    },
    EXEC_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// requirement 4 / Amendment 1.A (RED until package.json declares the
// script): `bun run analyze` exists, runs the full fallow pipeline, and
// fails on any finding via the flag proven above to actually gate.
// ---------------------------------------------------------------------------

describe("Amendment 1.A (RED until declared): package.json defines an 'analyze' script that runs the full fallow pipeline and fails on findings", () => {
  test("scripts.analyze is declared", () => {
    const pkg = readPackageJson();
    expect(pkg.scripts?.analyze, "package.json scripts.analyze must be declared").toBeDefined();
  });

  test("scripts.analyze invokes fallow with '--fail-on-issues' specifically - NOT '--ci', which gap 2 proved does not gate", () => {
    const pkg = readPackageJson();
    const script = pkg.scripts?.analyze ?? "";
    expect(script, "scripts.analyze must be declared").not.toBe("");
    expect(/\bfallow\b/.test(script), `scripts.analyze must invoke fallow: '${script}'`).toBe(true);
    expect(/--fail-on-issues\b/.test(script), `scripts.analyze must use --fail-on-issues (proven to gate): '${script}'`).toBe(true);
  });

  test("anti-bypass: scripts.analyze does not substitute the unproven '--ci' flag for '--fail-on-issues'", () => {
    const pkg = readPackageJson();
    const script = pkg.scripts?.analyze ?? "";
    // Using --ci alongside --fail-on-issues would be redundant but harmless;
    // the failure mode this guards against is --ci used INSTEAD of the
    // flag proven to work.
    if (/--ci\b/.test(script)) {
      expect(/--fail-on-issues\b/.test(script), `'--ci' alone does not gate; scripts.analyze must also use --fail-on-issues: '${script}'`).toBe(
        true,
      );
    }
  });

  test("anti-bypass: scripts.analyze does not discard/normalize its own exit code", () => {
    const pkg = readPackageJson();
    const script = pkg.scripts?.analyze ?? "";
    expect(collapsesOrDiscardsExitCode(script), `scripts.analyze must propagate its real exit code: '${script}'`).toBe(false);
  });

  test("anti-bypass: scripts.analyze does not compare against a saved baseline/regression snapshot instead of the exceptions document", () => {
    const pkg = readPackageJson();
    const script = pkg.scripts?.analyze ?? "";
    expect(referencesSavedBaselineSnapshot(script), `scripts.analyze must not reference a saved baseline: '${script}'`).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Amendment 1.A (CI portion): a separate CI workflow runs `fallow audit`
// (the changed-file gate) on pull requests and relevant branch pushes, and
// cannot be weakened by continue-on-error, `|| true`, a discarding
// redirect, an event condition that skips ordinary pull requests, a
// `--gate` value that defeats "fails only on introduced findings", or a
// base-ref choice that makes the changed-file comparison trivially empty.
// ---------------------------------------------------------------------------

interface StepShape {
  run?: string;
  uses?: string;
  "continue-on-error"?: boolean | string;
}

interface JobShape {
  "runs-on"?: string | string[];
  steps?: StepShape[];
  "continue-on-error"?: boolean | string;
  if?: unknown;
}

interface WorkflowDoc {
  on?: unknown;
  jobs?: Record<string, JobShape>;
}

interface LoadedWorkflow {
  file: string;
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
    const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    let doc: WorkflowDoc | null = null;
    try {
      doc = yaml.load(text) as WorkflowDoc;
    } catch {
      doc = null;
    }
    return { file, doc };
  });
}

const workflows = loadWorkflows();

function stepsOf(job: JobShape): StepShape[] {
  return job.steps ?? [];
}

/** `fallow audit ...` as its own word - not a substring of `fallow audit-cache` or similar. */
function jobRunsFallowAudit(job: JobShape): boolean {
  return stepsOf(job).some((s) => !!s.run && /\bfallow\s+audit\b(?!-)/.test(s.run));
}

function findFallowAuditWorkflow(): LoadedWorkflow | undefined {
  return workflows.find((wf) => Object.values(wf.doc?.jobs ?? {}).some(jobRunsFallowAudit));
}

const auditWorkflow = findFallowAuditWorkflow();

describe("a CI workflow runs `fallow audit`, the changed-file gate (Amendment 1.A)", () => {
  test("at least one workflow under .github/workflows has a job that runs `fallow audit`", () => {
    expect(auditWorkflow, "no workflow found with a step running 'fallow audit'").toBeDefined();
  });

  test("that workflow triggers on pull_request", () => {
    expect(auditWorkflow).toBeDefined();
    const on = auditWorkflow?.doc?.on;
    const hasPullRequest = typeof on === "object" && on !== null && "pull_request" in (on as object);
    expect(hasPullRequest, `'on' must include pull_request; got: ${JSON.stringify(on)}`).toBe(true);
  });

  test("that workflow also triggers on a relevant branch push", () => {
    expect(auditWorkflow).toBeDefined();
    const on = auditWorkflow?.doc?.on;
    const hasPush = typeof on === "object" && on !== null && "push" in (on as object);
    expect(hasPush, `'on' must include push; got: ${JSON.stringify(on)}`).toBe(true);
  });
});

/** True when a job-level `if:` condition would exclude the `pull_request` event (mirrors the equivalent helper already accepted in tests/ci-quality-workflow.test.ts). */
function jobConditionExcludesPullRequest(condition: unknown): boolean {
  const text = String(condition ?? "").trim();
  if (!text) return false;
  if (/event_name\s*!=\s*['"]pull_request['"]/.test(text)) return true;
  const equalsOtherEvent = /event_name\s*==\s*['"](\w+)['"]/.exec(text);
  if (equalsOtherEvent && equalsOtherEvent[1] !== "pull_request" && !/pull_request/.test(text)) return true;
  return false;
}

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

describe("the audit workflow actually runs for ordinary pull requests, not just declares the trigger (Amendment 1.A, anti-bypass)", () => {
  test("on.pull_request is not restricted by a branches allowlist or a paths/paths-ignore filter", () => {
    expect(auditWorkflow, "fallow audit workflow must exist").toBeDefined();
    expect(
      pullRequestTriggerIsUnrestricted(auditWorkflow?.doc?.on),
      `'on.pull_request' must not be narrowed away from ordinary source changes; got: ${JSON.stringify(auditWorkflow?.doc?.on)}`,
    ).toBe(true);
  });

  test("no job running 'fallow audit' carries an if: condition that excludes pull_request", () => {
    expect(auditWorkflow, "fallow audit workflow must exist").toBeDefined();
    const jobs = Object.entries(auditWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const [jobName, job] of jobs) {
      if (!jobRunsFallowAudit(job)) continue;
      if (jobConditionExcludesPullRequest(job.if)) offenders.push(`${jobName}: if: '${String(job.if)}'`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("the fallow audit gate cannot be weakened (Amendment 1.A + shared anti-bypass)", () => {
  test("no job or step in any workflow that runs 'fallow audit' sets continue-on-error", () => {
    expect(auditWorkflow, "fallow audit workflow must exist").toBeDefined();
    const jobs = Object.entries(auditWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const [jobName, job] of jobs) {
      if (!jobRunsFallowAudit(job)) continue;
      if (job["continue-on-error"]) offenders.push(`job:${jobName}`);
      for (const [i, step] of stepsOf(job).entries()) {
        if (step["continue-on-error"]) offenders.push(`job:${jobName} step:${i}`);
      }
    }
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  test("the 'fallow audit' step's run text does not discard/normalize its exit code (would hide the exit-1-vs-2 distinction)", () => {
    expect(auditWorkflow, "fallow audit workflow must exist").toBeDefined();
    const jobs = Object.values(auditWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const job of jobs) {
      for (const step of stepsOf(job)) {
        if (!step.run || !/\bfallow\s+audit\b(?!-)/.test(step.run)) continue;
        if (collapsesOrDiscardsExitCode(step.run)) offenders.push(step.run);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("no step anywhere in the audit workflow references a saved baseline/regression snapshot", () => {
    expect(auditWorkflow, "fallow audit workflow must exist").toBeDefined();
    const jobs = Object.values(auditWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const job of jobs) {
      for (const step of stepsOf(job)) {
        if (step.run && referencesSavedBaselineSnapshot(step.run)) offenders.push(step.run);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lead review round 3, item 1: the audit step must not weaken the
// comparison via a `--gate` value that defeats "fails only on introduced
// findings", or a base-ref choice that makes the changed-file diff
// trivially empty (e.g. diffing a ref against itself).
//
// Measured empirically against this repo (dirty working tree, real
// findings): `fallow audit` defaults to `--gate new-only`, attributing each
// finding as introduced-vs-inherited so the pre-existing backlog in a
// touched file does not fail the build. `--gate all` skips that attribution
// pass entirely and instead fails on EVERY finding in every changed file
// regardless of whether the changeset introduced it - exactly the
// "pre-existing backlog blocks the PR" outcome Amendment 1.A rejects. Only
// `new-only` (the default, so also satisfied by omitting `--gate` entirely)
// is therefore acceptable.
// ---------------------------------------------------------------------------

/** True when the run text explicitly sets `--gate` to a value other than `new-only` (omitting `--gate` entirely is fine - the CLI default IS new-only). */
function gateValueDefeatsIntroducedOnlyComparison(command: string): boolean {
  const match = /--gate[= ]("[^"]+"|'[^']+'|\S+)/.exec(command);
  if (!match) return false;
  const value = match[1].replace(/^["']|["']$/g, "");
  return value !== "new-only";
}

/** True when an explicit `--changed-since`/`--base` value would make the changed-file comparison trivially empty: a bare `HEAD` (no `~`/`^` offset) or a live GitHub Actions ref/sha expression for the very commit being analyzed, rather than a genuinely different target like `origin/main` or the PR's base ref. */
function baseRefIsSelfReferential(value: string): boolean {
  const trimmed = value.trim();
  if (/^HEAD$/.test(trimmed)) return true;
  if (/\$\{\{\s*github\.sha\s*\}\}/.test(trimmed)) return true;
  if (/\$\{\{\s*github\.ref\s*\}\}/.test(trimmed)) return true;
  if (/\$\{\{\s*github\.head_ref\s*\}\}/.test(trimmed)) return true;
  return false;
}

function commandUsesSelfReferentialBase(command: string): boolean {
  const match = /--(?:changed-since|base)[= ]("[^"]+"|'[^']+'|\S+)/.exec(command);
  if (!match) return false;
  const value = match[1].replace(/^["']|["']$/g, "");
  return baseRefIsSelfReferential(value);
}

describe("gateValueDefeatsIntroducedOnlyComparison / commandUsesSelfReferentialBase / baseRefIsSelfReferential helper correctness", () => {
  test("omitting --gate entirely is accepted (CLI default is new-only)", () => {
    expect(gateValueDefeatsIntroducedOnlyComparison("fallow audit --format sarif")).toBe(false);
  });

  test("an explicit '--gate new-only' is accepted", () => {
    expect(gateValueDefeatsIntroducedOnlyComparison("fallow audit --gate new-only")).toBe(false);
  });

  test("'--gate all' is rejected (fails on pre-existing findings in touched files, not just introduced ones)", () => {
    expect(gateValueDefeatsIntroducedOnlyComparison("fallow audit --gate all")).toBe(true);
    expect(gateValueDefeatsIntroducedOnlyComparison("fallow audit --gate=all")).toBe(true);
  });

  test("baseRefIsSelfReferential flags a bare HEAD and live github.sha/ref/head_ref expressions", () => {
    expect(baseRefIsSelfReferential("HEAD")).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression syntax, not JS interpolation
    expect(baseRefIsSelfReferential("${{ github.sha }}")).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression syntax, not JS interpolation
    expect(baseRefIsSelfReferential("${{ github.ref }}")).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression syntax, not JS interpolation
    expect(baseRefIsSelfReferential("${{ github.head_ref }}")).toBe(true);
  });

  test("baseRefIsSelfReferential does not flag a genuinely different target ref", () => {
    expect(baseRefIsSelfReferential("origin/main")).toBe(false);
    expect(baseRefIsSelfReferential("HEAD~5")).toBe(false);
    expect(baseRefIsSelfReferential("HEAD^")).toBe(false);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression syntax, not JS interpolation
    expect(baseRefIsSelfReferential("${{ github.event.pull_request.base.sha }}")).toBe(false);
  });

  test("commandUsesSelfReferentialBase reads both --changed-since and its --base alias", () => {
    expect(commandUsesSelfReferentialBase("fallow audit --changed-since HEAD")).toBe(true);
    expect(commandUsesSelfReferentialBase("fallow audit --base HEAD")).toBe(true);
    expect(commandUsesSelfReferentialBase("fallow audit --base origin/main")).toBe(false);
  });

  test("commandUsesSelfReferentialBase returns false when no base flag is present at all (the safe default path)", () => {
    expect(commandUsesSelfReferentialBase("fallow audit --format sarif")).toBe(false);
  });
});

describe("the audit step does not weaken the introduced-findings comparison (lead review round 3, item 1)", () => {
  test("no 'fallow audit' step sets --gate to anything other than new-only", () => {
    expect(auditWorkflow, "fallow audit workflow must exist").toBeDefined();
    const jobs = Object.values(auditWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const job of jobs) {
      for (const step of stepsOf(job)) {
        if (!step.run || !/\bfallow\s+audit\b(?!-)/.test(step.run)) continue;
        if (gateValueDefeatsIntroducedOnlyComparison(step.run)) offenders.push(step.run);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("no 'fallow audit' step sets a self-referential --changed-since/--base that would make the comparison trivially empty", () => {
    expect(auditWorkflow, "fallow audit workflow must exist").toBeDefined();
    const jobs = Object.values(auditWorkflow?.doc?.jobs ?? {});
    const offenders: string[] = [];
    for (const job of jobs) {
      for (const step of stepsOf(job)) {
        if (!step.run || !/\bfallow\s+audit\b(?!-)/.test(step.run)) continue;
        if (commandUsesSelfReferentialBase(step.run)) offenders.push(step.run);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
