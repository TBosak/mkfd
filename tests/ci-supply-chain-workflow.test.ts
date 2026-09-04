import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Specifies the supply-chain security-gate contract from the
// `p1-dependency-ci-security-baseline` requirements brief, requirement 7:
// full-history secret scanning, dependency review/audit, CodeQL/SAST,
// filesystem+IaC scanning, a built-container vulnerability scan, and an
// SPDX/CycloneDX SBOM uploaded as an artifact - all with least-privilege
// permissions, immutable commit-SHA action pins, no continue-on-error on
// release gates, and no privileged Docker/network-host escape.
//
// Coverage is identified by *role* (which step patterns appear), not by a
// hardcoded workflow filename, since this slice's production side is free
// to name/organize the workflow file(s). Whichever workflow(s) provide a
// given category's steps are then held to the least-privilege/pinning/
// continue-on-error/privileged-escape bar for those specific jobs.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

interface StepShape {
  run?: string;
  uses?: string;
  "continue-on-error"?: boolean | string;
  with?: Record<string, unknown>;
}

interface JobShape {
  steps?: StepShape[];
  permissions?: unknown;
  "continue-on-error"?: boolean | string;
}

interface WorkflowDoc {
  on?: unknown;
  jobs?: Record<string, JobShape>;
  permissions?: unknown;
}

interface LoadedWorkflow {
  file: string;
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
    const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    let doc: WorkflowDoc | null = null;
    try {
      doc = yaml.load(text) as WorkflowDoc;
    } catch {
      doc = null;
    }
    return { file, text, doc };
  });
}

const workflows = loadWorkflows();

function allJobEntries(): Array<{ file: string; jobName: string; job: JobShape }> {
  const result: Array<{ file: string; jobName: string; job: JobShape }> = [];
  for (const wf of workflows) {
    for (const [jobName, job] of Object.entries(wf.doc?.jobs ?? {})) {
      result.push({ file: wf.file, jobName, job });
    }
  }
  return result;
}

function stepMatchesAny(step: StepShape, patterns: RegExp[]): boolean {
  const haystacks = [step.uses ?? "", step.run ?? ""];
  return patterns.some((p) => haystacks.some((h) => p.test(h)));
}

/** 40-hex-char commit SHA following the final '@' - the only form that is immutable regardless of upstream tag mutation. */
function isPinnedToCommitSha(usesValue: string): boolean {
  const match = /@([0-9a-fA-F]{40})(\s|$)/.exec(usesValue);
  return !!match;
}

function isThirdPartyAction(usesValue: string): boolean {
  // Local (./), reusable-workflow (owner/repo/.github/workflows/...), or docker (docker://) references are out of scope here.
  if (usesValue.startsWith("./") || usesValue.startsWith("docker://")) return false;
  const owner = usesValue.split("/")[0];
  return owner !== "actions";
}

describe("isPinnedToCommitSha / isThirdPartyAction helper correctness", () => {
  test("rejects a floating major/minor version tag", () => {
    expect(isPinnedToCommitSha("actions/checkout@v4")).toBe(false);
    expect(isPinnedToCommitSha("aquasecurity/trivy-action@0.28.0")).toBe(false);
  });

  test("accepts a full 40-hex-character commit SHA", () => {
    expect(isPinnedToCommitSha(`actions/checkout@${"a".repeat(40)}`)).toBe(true);
  });

  test("rejects a short/abbreviated SHA (not guaranteed immutable/unambiguous)", () => {
    expect(isPinnedToCommitSha("actions/checkout@a1b2c3d")).toBe(false);
  });

  test("classifies first-party actions/* as not third-party, everything else as third-party", () => {
    expect(isThirdPartyAction("actions/checkout@v4")).toBe(false);
    expect(isThirdPartyAction("oven-sh/setup-bun@v2")).toBe(true);
    expect(isThirdPartyAction("aquasecurity/trivy-action@0.28.0")).toBe(true);
    expect(isThirdPartyAction("github/codeql-action/init@v3")).toBe(true);
  });

  test("does not flag local or docker-reference 'uses' values as third-party actions requiring a SHA pin", () => {
    expect(isThirdPartyAction("./.github/actions/local-action")).toBe(false);
    expect(isThirdPartyAction("docker://alpine:3.19")).toBe(false);
  });
});

function stepsOf(job: JobShape): StepShape[] {
  return job.steps ?? [];
}

/**
 * A `bun audit`-family invocation - deliberately distinct from
 * `dependencyReview` below. `dependency-review-action` only inspects the
 * dependencies a pull request *changes*; it never inspects the pre-existing
 * frozen lock graph, so it cannot alone satisfy requirement 4's "the
 * resulting frozen graph reports zero Critical/High". Matching only against
 * `step.run` (never `step.uses`) makes that structural, not just a wording
 * choice: `dependency-review-action` has no `run` field at all, so it can
 * never accidentally satisfy this category regardless of how it's labeled.
 */
function isFullGraphAuditStep(step: StepShape): boolean {
  return !!step.run && /\bbun\s+(pm\s+)?audit\b/i.test(step.run);
}

const CATEGORY_MATCHERS: Record<string, (step: StepShape) => boolean> = {
  secretScanning: (step) => stepMatchesAny(step, [/gitleaks/i, /trufflehog/i, /secret[-_]?scan/i]),
  dependencyReview: (step) => stepMatchesAny(step, [/dependency-review-action/i]),
  fullGraphAudit: isFullGraphAuditStep,
  sast: (step) => stepMatchesAny(step, [/github\/codeql-action/i, /semgrep/i]),
  filesystemOrIacScan: (step) => stepMatchesAny(step, [/trivy-action/i, /checkov/i, /tfsec/i]),
  containerScan: (step) => stepMatchesAny(step, [/trivy-action/i, /grype/i, /image-ref/i]),
  sbom: (step) => stepMatchesAny(step, [/anchore\/sbom-action/i, /\bsyft\b/i, /cyclonedx/i, /spdx/i]),
};

function jobsMatchingCategory(category: keyof typeof CATEGORY_MATCHERS): Array<{ file: string; jobName: string; job: JobShape }> {
  const matcher = CATEGORY_MATCHERS[category];
  return allJobEntries().filter(({ job }) => stepsOf(job).some(matcher));
}

describe("isFullGraphAuditStep helper correctness", () => {
  test("accepts a 'bun audit' run step", () => {
    expect(isFullGraphAuditStep({ run: "bun audit --json" })).toBe(true);
  });

  test("accepts a 'bun pm audit' run step", () => {
    expect(isFullGraphAuditStep({ run: "bun pm audit --json" })).toBe(true);
  });

  test("does not accept a dependency-review-action step (uses only, no run) - it never inspects the pre-existing lock graph", () => {
    expect(isFullGraphAuditStep({ uses: `actions/dependency-review-action@${"a".repeat(40)}` })).toBe(false);
  });

  test("does not accept an unrelated run step", () => {
    expect(isFullGraphAuditStep({ run: "bun install --frozen-lockfile" })).toBe(false);
  });
});

describe("supply-chain evidence categories are each provided by at least one job (requirement 7)", () => {
  test("full-history secret scanning is present", () => {
    expect(jobsMatchingCategory("secretScanning").length, "expected a job running a secret-scanning tool").toBeGreaterThan(0);
  });

  test("the secret-scanning job fetches full git history (fetch-depth: 0), not a shallow clone", () => {
    const matches = jobsMatchingCategory("secretScanning");
    expect(matches.length).toBeGreaterThan(0);
    for (const { file, job } of matches) {
      const checkoutStep = stepsOf(job).find((s) => s.uses && /actions\/checkout/.test(s.uses));
      expect(checkoutStep, `${file}: secret-scan job must have a checkout step`).toBeDefined();
      const fetchDepth = checkoutStep?.with?.["fetch-depth"];
      expect(String(fetchDepth), `${file}: checkout must set fetch-depth: 0 for full-history scanning`).toBe("0");
    }
  });

  test("dependency review/audit evidence is present (either PR-scoped review or a full-graph audit)", () => {
    const evidence = [...jobsMatchingCategory("dependencyReview"), ...jobsMatchingCategory("fullGraphAudit")];
    expect(evidence.length).toBeGreaterThan(0);
  });

  test("CodeQL/SAST evidence is present", () => {
    expect(jobsMatchingCategory("sast").length).toBeGreaterThan(0);
  });

  test("filesystem/IaC scanning evidence is present", () => {
    expect(jobsMatchingCategory("filesystemOrIacScan").length).toBeGreaterThan(0);
  });

  test("a built-container vulnerability scan is present", () => {
    expect(jobsMatchingCategory("containerScan").length).toBeGreaterThan(0);
  });

  test("an SPDX/CycloneDX SBOM generation step is present", () => {
    expect(jobsMatchingCategory("sbom").length).toBeGreaterThan(0);
  });

  test("the SBOM is uploaded as a workflow artifact, not merely generated and discarded", () => {
    const matches = jobsMatchingCategory("sbom");
    expect(matches.length).toBeGreaterThan(0);
    for (const { file, job } of matches) {
      const uploadStep = stepsOf(job).find((s) => s.uses && /actions\/upload-artifact/.test(s.uses));
      expect(uploadStep, `${file}: SBOM job must upload the SBOM via actions/upload-artifact`).toBeDefined();
    }
  });
});

const supplyChainCategories = Object.keys(CATEGORY_MATCHERS) as Array<keyof typeof CATEGORY_MATCHERS>;

function isSupplyChainJob(entry: { job: JobShape }): boolean {
  return supplyChainCategories.some((cat) => stepsOf(entry.job).some(CATEGORY_MATCHERS[cat]));
}

function hasRootFrozenInstall(steps: StepShape[]): boolean {
  return steps.some((step) => {
    if (!step.run) return false;
    if (!/\bbun\s+install\b/.test(step.run) || !/--frozen-lockfile/.test(step.run)) return false;
    return !/frontend/i.test(step.run);
  });
}

/**
 * True when a `bun audit` step's outcome genuinely gates the workflow: either
 * it has no pipe/redirect at all (its own non-zero exit code fails the step
 * directly), or - if it does pipe/redirect its output (e.g. to save a JSON
 * report) - some subsequent step in the same job explicitly checks that
 * report and fails on Critical/High severity. A step that pipes/redirects
 * with no such follow-up silently discards the audit's exit status.
 */
function auditStepIsHardGate(steps: StepShape[], auditStepIndex: number): boolean {
  const auditStep = steps[auditStepIndex];
  const run = auditStep.run ?? "";
  const pipesOrRedirectsOutput = /(?<!\|)\|(?!\|)/.test(run) || />/.test(run);
  if (!pipesOrRedirectsOutput) return true;
  const laterSteps = steps.slice(auditStepIndex + 1);
  return laterSteps.some((s) => !!s.run && /\b(critical|high)\b/i.test(s.run) && /\b(exit\s+1|fail)\b/i.test(s.run));
}

describe("hasRootFrozenInstall / auditStepIsHardGate helper correctness", () => {
  test("hasRootFrozenInstall accepts a root-scoped frozen install and rejects a frontend-scoped one", () => {
    expect(hasRootFrozenInstall([{ run: "bun install --frozen-lockfile" }])).toBe(true);
    expect(hasRootFrozenInstall([{ run: "bun install --frozen-lockfile", with: {} }])).toBe(true);
    expect(hasRootFrozenInstall([{ run: "cd frontend && bun install --frozen-lockfile" }])).toBe(false);
    expect(hasRootFrozenInstall([{ run: "bun install" }])).toBe(false);
  });

  test("auditStepIsHardGate accepts a plain audit step with no pipe/redirect", () => {
    const steps: StepShape[] = [{ run: "bun audit --json" }];
    expect(auditStepIsHardGate(steps, 0)).toBe(true);
  });

  test("auditStepIsHardGate rejects a piped audit step with no follow-up check", () => {
    const steps: StepShape[] = [{ run: "bun audit --json | jq '.'" }];
    expect(auditStepIsHardGate(steps, 0)).toBe(false);
  });

  test("auditStepIsHardGate rejects a redirected audit step with no follow-up check", () => {
    const steps: StepShape[] = [{ run: "bun audit --json > audit-report.json" }];
    expect(auditStepIsHardGate(steps, 0)).toBe(false);
  });

  test("auditStepIsHardGate accepts a redirected audit step followed by a step that fails the job on Critical/High", () => {
    const steps: StepShape[] = [
      { run: "bun audit --json > audit-report.json" },
      { run: "node scripts/check-audit-report.js --fail-on=critical,high" },
    ];
    expect(auditStepIsHardGate(steps, 0)).toBe(true);
  });

  test("auditStepIsHardGate does not accept an unrelated follow-up step (must actually mention severity + fail/exit)", () => {
    const steps: StepShape[] = [{ run: "bun audit --json > audit-report.json" }, { run: "echo done" }];
    expect(auditStepIsHardGate(steps, 0)).toBe(false);
  });

  test("auditStepIsHardGate does not misclassify '||' (logical OR) as a discarding pipe", () => {
    const steps: StepShape[] = [{ run: "bun audit --json || exit 1" }];
    expect(auditStepIsHardGate(steps, 0)).toBe(true);
  });
});

describe("full-graph dependency audit is a genuine hard gate on the frozen lock graph (requirement 4, gap 4)", () => {
  function fullGraphAuditSteps(): Array<{ file: string; jobName: string; job: JobShape; stepIndex: number }> {
    const result: Array<{ file: string; jobName: string; job: JobShape; stepIndex: number }> = [];
    for (const { file, jobName, job } of allJobEntries()) {
      stepsOf(job).forEach((step, stepIndex) => {
        if (isFullGraphAuditStep(step)) result.push({ file, jobName, job, stepIndex });
      });
    }
    return result;
  }

  test("at least one job runs a full-graph 'bun audit' step (not merely a PR-scoped dependency-review-action)", () => {
    expect(fullGraphAuditSteps().length, "expected a 'bun audit'-family step somewhere in .github/workflows").toBeGreaterThan(0);
  });

  test("the full-graph audit runs in a job that also performs a frozen root install (it audits the actual installed graph, not an arbitrary/stale one)", () => {
    const matches = fullGraphAuditSteps();
    expect(matches.length).toBeGreaterThan(0);
    for (const { file, jobName, job } of matches) {
      expect(
        hasRootFrozenInstall(stepsOf(job)),
        `${file}:${jobName} must also install the root graph via 'bun install --frozen-lockfile' before auditing it`,
      ).toBe(true);
    }
  });

  test("the full-graph audit step's result is a hard gate, not silently discarded via an unchecked pipe/redirect", () => {
    const matches = fullGraphAuditSteps();
    expect(matches.length).toBeGreaterThan(0);
    for (const { file, jobName, job, stepIndex } of matches) {
      expect(
        auditStepIsHardGate(stepsOf(job), stepIndex),
        `${file}:${jobName}[${stepIndex}] audit step must fail the job on Critical/High, not discard its result`,
      ).toBe(true);
    }
  });
});

describe("least-privilege permissions on supply-chain jobs (requirement 7)", () => {
  test("no workflow file grants permissions: write-all anywhere", () => {
    const offenders = workflows.filter((wf) => /permissions:\s*write-all/.test(wf.text));
    expect(offenders.map((w) => w.file)).toEqual([]);
  });

  test("every supply-chain job declares an explicit permissions block (workflow-level or job-level), not the broad default token", () => {
    const entries = allJobEntries().filter(isSupplyChainJob);
    expect(entries.length, "expected at least one supply-chain job to exist").toBeGreaterThan(0);
    for (const { file, jobName, job } of entries) {
      const wf = workflows.find((w) => w.file === file);
      const hasJobLevel = job.permissions !== undefined;
      const hasWorkflowLevel = wf?.doc?.permissions !== undefined;
      expect(hasJobLevel || hasWorkflowLevel, `${file}:${jobName} must declare an explicit permissions block`).toBe(true);
    }
  });
});

describe("immutable commit-SHA pins for third-party actions in supply-chain jobs (requirement 7)", () => {
  test("every third-party 'uses' in a supply-chain job is pinned to a 40-character commit SHA", () => {
    const entries = allJobEntries().filter(isSupplyChainJob);
    expect(entries.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { file, jobName, job } of entries) {
      for (const [i, step] of stepsOf(job).entries()) {
        if (!step.uses || !isThirdPartyAction(step.uses)) continue;
        if (!isPinnedToCommitSha(step.uses)) offenders.push(`${file}:${jobName}[${i}] uses '${step.uses}'`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("no continue-on-error on supply-chain release gates (requirement 7 anti-bypass)", () => {
  test("no supply-chain job or step sets continue-on-error", () => {
    const entries = allJobEntries().filter(isSupplyChainJob);
    expect(entries.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { file, jobName, job } of entries) {
      if (job["continue-on-error"]) offenders.push(`${file}:${jobName} (job-level)`);
      for (const [i, step] of stepsOf(job).entries()) {
        if (step["continue-on-error"]) offenders.push(`${file}:${jobName}[${i}]`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("no supply-chain workflow suppresses a scanner failure with an unconditional '|| true'", () => {
    const entries = allJobEntries().filter(isSupplyChainJob);
    expect(entries.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { file, jobName, job } of entries) {
      for (const [i, step] of stepsOf(job).entries()) {
        if (step.run && /\|\|\s*true\b/.test(step.run)) offenders.push(`${file}:${jobName}[${i}]`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("no supply-chain job runs only on a condition that skips ordinary pull requests (event-condition anti-bypass)", () => {
    // A gate whose job-level `if:` excludes pull_request entirely (e.g. only
    // `github.event_name == 'push'`) would satisfy every step-pattern check
    // above while never actually running on ordinary PRs.
    const entries = allJobEntries().filter(isSupplyChainJob);
    expect(entries.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { file, jobName, job } of entries) {
      const condition = String((job as { if?: unknown }).if ?? "");
      if (/event_name\s*[!=]=\s*['"]pull_request['"]/.test(condition) && /!=/.test(condition)) {
        offenders.push(`${file}:${jobName} if: '${condition}'`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("no privileged Docker/network-host escape in supply-chain jobs (requirement 7)", () => {
  test("no supply-chain step runs Docker with --privileged or host networking", () => {
    const entries = allJobEntries().filter(isSupplyChainJob);
    expect(entries.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { file, jobName, job } of entries) {
      for (const [i, step] of stepsOf(job).entries()) {
        const run = step.run ?? "";
        const withNetwork = String(step.with?.network ?? "");
        const withAllow = String(step.with?.allow ?? "");
        if (
          /--privileged\b/.test(run) ||
          /--network[= ]host\b/.test(run) ||
          withNetwork === "host" ||
          /network\.host/.test(withAllow)
        ) {
          offenders.push(`${file}:${jobName}[${i}]`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
