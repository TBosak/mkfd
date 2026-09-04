import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the `p1-fallow-static-analysis-gate` requirements brief
// (Packet 1 follow-up), requirements 5 and 6, AS NARROWED BY AMENDMENT 1.B:
// exceptions are the LAST resort, not the mechanism - the expected steady
// state is an empty array. `docs/security/static-analysis-exceptions.md`
// still exists and keeps its schema contract (path, finding type, owning
// packet/V2-finding id, rationale, review date; no whole-directory or
// wildcard path; no more than one release cycle out; genuinely dead code is
// never a legitimate target). What changed is the cross-check below: it no
// longer demands an exception record for every unused-file finding - only
// for one NOT already covered by Amendment 1.C's cited protected-path list
// (see tests/fallow-static-analysis-gate.test.ts's PROTECTED_CITED_PATHS,
// duplicated here per this repo's established per-file helper convention).
//
// The brief leaves the concrete file format to this slice's design, exactly
// as tests/dependency-audit-exceptions-policy.test.ts already did for the
// sibling dependency-audit exceptions document: this suite pins down one
// concrete, offline-parseable contract mirroring that doc's fenced ```json
// array convention, adapted to the fields requirement 5 names explicitly
// (path / findingType / owner / rationale / reviewBy).
//
// "one release cycle" has no defined length anywhere in this repo (no
// CONTRIBUTING.md/README cadence, no version-scheme hint beyond a v2 -> v3
// major revision). This suite interprets it as 90 days from the time the
// test runs, matching the horizon docs/security/dependency-audit-exceptions.md
// (the sibling document this one deliberately mirrors) already uses for its
// own entries, so the repo has one consistent expiry horizon across both
// exception documents rather than two different undefined-term readings.
// This interpretation is a design choice the lead should confirm or
// override, not a fact discovered from the codebase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const POLICY_PATH = join(REPO_ROOT, "docs", "security", "static-analysis-exceptions.md");
const ONE_RELEASE_CYCLE_DAYS = 90;
const EXEC_TIMEOUT_MS = 30_000;

interface ExceptionRecord {
  path?: unknown;
  findingType?: unknown;
  owner?: unknown;
  rationale?: unknown;
  reviewBy?: unknown;
}

function extractJsonBlock(markdown: string): unknown {
  const match = /```json\s*([\s\S]*?)```/.exec(markdown);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

describe("extractJsonBlock helper correctness", () => {
  test("extracts and parses a fenced json code block", () => {
    const markdown = '# Doc\n\n```json\n[{"path": "a"}]\n```\n';
    expect(extractJsonBlock(markdown)).toEqual([{ path: "a" }]);
  });

  test("returns undefined when there is no fenced json block", () => {
    expect(extractJsonBlock("# Doc\n\nno code block here\n")).toBeUndefined();
  });

  test("returns undefined for malformed JSON inside the fence", () => {
    expect(extractJsonBlock("```json\n{not valid json\n```")).toBeUndefined();
  });
});

const policyExists = existsSync(POLICY_PATH);
const policySource = policyExists ? readFileSync(POLICY_PATH, "utf8") : null;
const policyJson = policySource !== null ? extractJsonBlock(policySource) : undefined;
const exceptions: ExceptionRecord[] = Array.isArray(policyJson) ? (policyJson as ExceptionRecord[]) : [];

describe("static analysis exception policy document (requirement 5)", () => {
  test("docs/security/static-analysis-exceptions.md exists", () => {
    expect(policyExists, `expected a policy document at ${POLICY_PATH}`).toBe(true);
  });

  test("the document contains a parseable fenced ```json array of exception records", () => {
    expect(policySource, "policy document must exist to be parsed").not.toBeNull();
    expect(
      Array.isArray(policyJson),
      "the fenced json block must parse to an array (use [] when there are no exceptions)",
    ).toBe(true);
  });

  test("every exception record declares path, findingType, owner, rationale, and reviewBy as non-empty strings", () => {
    for (const [index, record] of exceptions.entries()) {
      for (const field of ["path", "findingType", "owner", "rationale", "reviewBy"] as const) {
        const value = record[field];
        expect(typeof value, `exceptions[${index}].${field} must be a string`).toBe("string");
        expect((value as string)?.length, `exceptions[${index}].${field} must be non-empty`).toBeGreaterThan(0);
      }
    }
  });

  test("every exception's reviewBy is a real, parseable calendar date (an expiry condition, not free text)", () => {
    for (const [index, record] of exceptions.entries()) {
      const reviewBy = record.reviewBy as string;
      const parsed = Date.parse(reviewBy);
      expect(Number.isNaN(parsed), `exceptions[${index}].reviewBy = '${reviewBy}' must be a parseable date`).toBe(false);
    }
  });

  test(`every exception's reviewBy is no more than one release cycle out (interpreted as ${ONE_RELEASE_CYCLE_DAYS} days from now)`, () => {
    const maxDate = Date.now() + ONE_RELEASE_CYCLE_DAYS * 24 * 60 * 60 * 1000;
    for (const [index, record] of exceptions.entries()) {
      const parsed = Date.parse(record.reviewBy as string);
      if (Number.isNaN(parsed)) continue; // reported by the preceding test
      expect(
        parsed,
        `exceptions[${index}].reviewBy = '${record.reviewBy}' must be within ${ONE_RELEASE_CYCLE_DAYS} days of now`,
      ).toBeLessThanOrEqual(maxDate);
    }
  });

  test("every exception's owner names a packet or a V2 finding id (e.g. 'Packet 8' or 'V2-16'), not free text", () => {
    for (const [index, record] of exceptions.entries()) {
      const owner = String(record.owner ?? "");
      expect(
        /^(Packet\s+\d+|V2-\d+)$/.test(owner),
        `exceptions[${index}].owner = '${owner}' must match 'Packet <n>' or 'V2-<n>'`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// requirement 6 (anti-bypass): an exception may not cover a whole directory
// of first-party source, may not use a wildcard path, and genuinely dead
// code (the nine starter-config adapters) is not a legitimate target.
// ---------------------------------------------------------------------------

const DEAD_STARTER_ADAPTER_PATHS = [
  "calendar",
  "change-detection",
  "existing-feed",
  "graphql",
  "manual",
  "rest-api",
  "service-connector",
  "sitemap",
  "web-scraping",
].map((name) => `utilities/source-assistant/starter-configs/${name}.adapter.ts`);

describe("anti-bypass: an exception path is a single first-party file, never a directory or a wildcard (requirement 6)", () => {
  test("no exception path contains a wildcard character", () => {
    for (const [index, record] of exceptions.entries()) {
      const path = String(record.path ?? "");
      expect(path.includes("*"), `exceptions[${index}].path = '${path}' must not contain a wildcard`).toBe(false);
    }
  });

  test("no exception path ends with a trailing slash (a bare directory reference)", () => {
    for (const [index, record] of exceptions.entries()) {
      const path = String(record.path ?? "");
      expect(path.endsWith("/"), `exceptions[${index}].path = '${path}' must not be a bare directory`).toBe(false);
    }
  });

  test("every exception path resolves to a real, existing file (not a directory, not a made-up path)", () => {
    for (const [index, record] of exceptions.entries()) {
      const path = String(record.path ?? "");
      const full = join(REPO_ROOT, path);
      expect(existsSync(full), `exceptions[${index}].path = '${path}' must exist`).toBe(true);
      if (existsSync(full)) {
        expect(statSync(full).isFile(), `exceptions[${index}].path = '${path}' must be a file, not a directory`).toBe(true);
      }
    }
  });

  test("none of the nine genuinely-dead starter-config adapters appear as an exception (dead code must be deleted, not exempted)", () => {
    const exceptionPaths = new Set(exceptions.map((r) => String(r.path ?? "")));
    for (const deadPath of DEAD_STARTER_ADAPTER_PATHS) {
      expect(exceptionPaths.has(deadPath), `${deadPath} must not appear as an exception; it must be deleted`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Amendment 1.C: the five files with a cited packet/V2 owner are legitimate
// to stay unused without an exception record - Amendment 1.B's relaxed
// cross-check treats "covered by the cited protected-path list" as an
// alternative to "has an exception record", not an additional requirement.
// Must stay in sync with PROTECTED_CITED_PATHS in
// tests/fallow-static-analysis-gate.test.ts (that file owns the
// "still exists" + "nothing imports them differently" assertions for this
// list; this file only needs the same five paths to know what does NOT
// require an exception record).
// ---------------------------------------------------------------------------

const PROTECTED_CITED_PATHS = new Set([
  "frontend/src/components/builder/KVEditor.tsx", // V2-02
  "frontend/src/components/catalog/CatalogMetadataForm.tsx", // Packet 8
  "frontend/src/components/catalog/CatalogSanitizedYamlPreview.tsx", // Packet 8
  "frontend/src/components/catalog/CatalogSubmissionDialog.tsx", // Packet 8
  "frontend/src/components/forms/CookiesManager.tsx", // V2-16
]);

// ---------------------------------------------------------------------------
// requirement 5 (RED until exceptions/fixes exist), narrowed by Amendment
// 1.B/1.C: every finding the real fallow oracle currently reports for a
// first-party file must be resolved (the file no longer appears in the
// finding, e.g. because it was deleted or declared an entry point),
// covered by the cited protected-path list, or explicitly recorded here.
// ---------------------------------------------------------------------------

function localFallowBinPath(): string {
  const dotBin = join(REPO_ROOT, "node_modules", ".bin");
  return process.platform === "win32" ? join(dotBin, "fallow.exe") : join(dotBin, "fallow");
}

interface DeadCodeFileFinding {
  path: string;
}

interface DeadCodeReport {
  unused_files?: DeadCodeFileFinding[];
  unused_exports?: DeadCodeFileFinding[];
  unused_types?: DeadCodeFileFinding[];
}

let cachedReport: DeadCodeReport | undefined;

function runDeadCodeOnce(): DeadCodeReport {
  if (cachedReport) return cachedReport;
  const bin = localFallowBinPath();
  const proc = Bun.spawnSync({
    cmd: [bin, "dead-code", "--format", "json", "--quiet"],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  cachedReport = JSON.parse(proc.stdout.toString()) as DeadCodeReport;
  return cachedReport;
}

describe("requirement 5 (RED until every remaining finding is fixed, cited, or recorded, Amendment 1.B/1.C): unused-file findings are resolved", () => {
  test(
    "every unused-file path the real fallow oracle currently reports is either cited in the protected-path list or has a corresponding exception record",
    () => {
      const report = runDeadCodeOnce();
      const exceptionPaths = new Set(exceptions.map((r) => String(r.path ?? "")));
      const uncovered = (report.unused_files ?? [])
        .map((f) => f.path)
        .filter((p) => !exceptionPaths.has(p) && !PROTECTED_CITED_PATHS.has(p));
      expect(uncovered, uncovered.join("\n")).toEqual([]);
    },
    EXEC_TIMEOUT_MS,
  );

  test(
    "sanity: at least one currently-unused file is covered ONLY via the protected-path list, not an exception record (proves the relaxation is real, not vacuous)",
    () => {
      const report = runDeadCodeOnce();
      const exceptionPaths = new Set(exceptions.map((r) => String(r.path ?? "")));
      const unusedPaths = new Set((report.unused_files ?? []).map((f) => f.path));
      const coveredOnlyByProtectedList = [...PROTECTED_CITED_PATHS].filter((p) => unusedPaths.has(p) && !exceptionPaths.has(p));
      expect(
        coveredOnlyByProtectedList.length,
        "expected at least one protected-cited path to currently be unused-but-uncited-by-exception, proving the cross-check relaxation actually does something",
      ).toBeGreaterThan(0);
    },
    EXEC_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// requirement 6 (anti-bypass): a config-level ignoreFindings entry is not
// itself a substitute for the documented exception - every path it silences
// must also carry an exception record, so the doc is the single source of
// truth for "why", not a config-only escape.
// ---------------------------------------------------------------------------

describe("anti-bypass: every .fallowrc.json ignoreFindings entry has a matching documented exception (requirement 6)", () => {
  test("no ignoreFindings path silences a finding without a corresponding exceptions.md record", () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, ".fallowrc.json"), "utf8")) as {
      ignoreFindings?: unknown;
    };
    const ignoreFindings = Array.isArray(config.ignoreFindings) ? (config.ignoreFindings as string[]) : [];
    const exceptionPaths = new Set(exceptions.map((r) => String(r.path ?? "")));
    const undocumented = ignoreFindings.filter((p) => !p.startsWith("!") && !exceptionPaths.has(p));
    expect(undocumented, undocumented.join("\n")).toEqual([]);
  });
});
