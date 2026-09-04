import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the dependency-audit exception-policy contract from the
// `p1-dependency-ci-security-baseline` requirements brief, requirement 4:
// "Moderate/Low findings may remain only when they are development-only or
// demonstrably unreachable and are documented with package path, rationale,
// mitigation, and a review/expiry condition."
//
// The brief leaves the concrete file format to this slice's design. This
// suite pins down one concrete, offline-parseable contract: a fenced ```json
// code block inside `docs/security/dependency-audit-exceptions.md`
// containing an array of exception records. An empty array is a fully valid
// document (no exceptions needed yet); the requirement is about what an
// exception must contain *if present*, not that one must exist.
//
// `bun audit` itself is explicitly out of scope here per the brief
// ("network-dependent bun audit ... belong to broader verification, not the
// unit-test prerequisite") - this suite only proves the policy document's
// own shape and its Critical/High anti-bypass guarantee.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const POLICY_PATH = join(REPO_ROOT, "docs", "security", "dependency-audit-exceptions.md");

interface ExceptionRecord {
  package?: unknown;
  severity?: unknown;
  rationale?: unknown;
  mitigation?: unknown;
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

const policyExists = existsSync(POLICY_PATH);
const policySource = policyExists ? readFileSync(POLICY_PATH, "utf8") : null;
const policyJson = policySource !== null ? extractJsonBlock(policySource) : undefined;
const exceptions: ExceptionRecord[] = Array.isArray(policyJson) ? (policyJson as ExceptionRecord[]) : [];

describe("extractJsonBlock helper correctness", () => {
  test("extracts and parses a fenced json code block", () => {
    const markdown = "# Doc\n\n```json\n[{\"package\": \"foo\"}]\n```\n";
    expect(extractJsonBlock(markdown)).toEqual([{ package: "foo" }]);
  });

  test("returns undefined when there is no fenced json block", () => {
    expect(extractJsonBlock("# Doc\n\nno code block here\n")).toBeUndefined();
  });

  test("returns undefined for malformed JSON inside the fence", () => {
    expect(extractJsonBlock("```json\n{not valid json\n```")).toBeUndefined();
  });
});

describe("dependency audit exception policy document (requirement 4)", () => {
  test("docs/security/dependency-audit-exceptions.md exists", () => {
    expect(policyExists, `expected a policy document at ${POLICY_PATH}`).toBe(true);
  });

  test("the document contains a parseable fenced ```json array of exception records", () => {
    expect(policySource, "policy document must exist to be parsed").not.toBeNull();
    expect(Array.isArray(policyJson), "the fenced json block must parse to an array (use [] when there are no exceptions)").toBe(
      true,
    );
  });

  test("every exception record declares package, severity, rationale, mitigation, and reviewBy as non-empty strings", () => {
    for (const [index, record] of exceptions.entries()) {
      expect(typeof record.package, `exceptions[${index}].package must be a string`).toBe("string");
      expect((record.package as string)?.length, `exceptions[${index}].package must be non-empty`).toBeGreaterThan(0);
      expect(typeof record.severity, `exceptions[${index}].severity must be a string`).toBe("string");
      expect(typeof record.rationale, `exceptions[${index}].rationale must be a string`).toBe("string");
      expect((record.rationale as string)?.length, `exceptions[${index}].rationale must be non-empty`).toBeGreaterThan(0);
      expect(typeof record.mitigation, `exceptions[${index}].mitigation must be a string`).toBe("string");
      expect((record.mitigation as string)?.length, `exceptions[${index}].mitigation must be non-empty`).toBeGreaterThan(0);
      expect(typeof record.reviewBy, `exceptions[${index}].reviewBy must be a string`).toBe("string");
    }
  });

  test("every exception's reviewBy is a real, parseable calendar date (an expiry condition, not free text)", () => {
    for (const [index, record] of exceptions.entries()) {
      const reviewBy = record.reviewBy as string;
      const parsed = Date.parse(reviewBy);
      expect(Number.isNaN(parsed), `exceptions[${index}].reviewBy = '${reviewBy}' must be a parseable date`).toBe(false);
    }
  });
});

describe("anti-bypass: exception policy cannot exempt Critical/High findings or the required direct-floor packages (requirement 4)", () => {
  const DIRECT_FLOOR_PACKAGES = new Set(["axios", "hono", "js-yaml", "mailparser", "xmldom", "@xmldom/xmldom"]);

  test("no exception record declares Critical or High severity", () => {
    for (const [index, record] of exceptions.entries()) {
      const severity = String(record.severity ?? "").trim().toLowerCase();
      expect(["critical", "high"].includes(severity), `exceptions[${index}].severity must not be Critical/High: '${record.severity}'`).toBe(
        false,
      );
    }
  });

  test("no exception record targets a wildcard package", () => {
    for (const [index, record] of exceptions.entries()) {
      expect(record.package, `exceptions[${index}].package must not be a wildcard`).not.toBe("*");
    }
  });

  test("no exception record exempts one of the five directly-required floor packages (those must be fixed, not exempted)", () => {
    for (const [index, record] of exceptions.entries()) {
      const pkg = String(record.package ?? "");
      expect(
        DIRECT_FLOOR_PACKAGES.has(pkg),
        `exceptions[${index}].package = '${pkg}' must not exempt a directly-required floor package`,
      ).toBe(false);
    }
  });
});
