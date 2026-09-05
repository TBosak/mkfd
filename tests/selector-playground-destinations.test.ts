// TDD slice: p2-selector-playground-isolation
//
// Static/structural coverage for two locked, non-negotiable contracts that
// must not silently regress while the isolation fix lands:
//
//   - Requirement 7: the Selector Playground is a retained v3 feature (locked
//     product decision 1), and all 16 named selector destinations must still
//     exist. A behavioral round-trip through a legitimately-authenticated
//     postMessage is exercised separately in
//     frontend/e2e/selector-playground-isolation.spec.ts; this suite guards
//     the destination *set* itself so an edit that quietly drops or renames a
//     field is caught even before that e2e coverage runs.
//   - The anti-bypass requirement that "allow-same-origin" must not reappear
//     anywhere in the playground iframe, including via a dynamically
//     constructed attribute — checked as a whole-tree literal-string scan so
//     it can't be reintroduced by moving the sandbox construction to a
//     different file.
//
// Follows the same TypeScript-compiler-API static-analysis pattern already
// used by tests/frontend-accessibility-semantics.test.ts: parse the real
// frontend/src TSX source with the one local `typescript` install under
// frontend/node_modules, rather than hard-coding assumptions about how the
// JSX is written.
import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const FRONTEND_SRC = join(FRONTEND_DIR, "src");
const PLAYGROUND_PATH = join(FRONTEND_SRC, "components", "forms", "SelectorPlayground.tsx");

const ts = require(join(FRONTEND_DIR, "node_modules/typescript")) as typeof import("typescript");

// Exact, locked set from the requirements brief (requirement 7) — order does
// not matter, but the set must match precisely: no additions, no removals,
// no renames.
const REQUIRED_SELECTOR_DESTINATIONS = [
  "itemSelector",
  "titleSelector",
  "descriptionSelector",
  "linkSelector",
  "enclosureSelector",
  "authorSelector",
  "dateSelector",
  "contentEncodedSelector",
  "summarySelector",
  "guidSelector",
  "categoriesSelector",
  "contributorsSelector",
  "latSelector",
  "longSelector",
  "sourceUrlSelector",
  "sourceTitleSelector",
];

function discoverFilesRecursive(
  dir: string,
  extensionPattern: RegExp,
  excludeDirNames: Set<string>,
): string[] {
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

function readPlaygroundSource(): string {
  return readFileSync(PLAYGROUND_PATH, "utf8");
}

function parsePlayground(source: string) {
  return ts.createSourceFile(
    PLAYGROUND_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

// ---------------------------------------------------------------------------
// Requirement 7 — the entry point and all 16 destinations still exist
// ---------------------------------------------------------------------------

describe("Selector Playground — the entry point and all 16 selector destinations remain intact (requirement 7)", () => {
  test("SelectorPlayground.tsx still exists and exports the component", () => {
    const source = readPlaygroundSource();
    expect(source).toContain("export const SelectorPlayground");
  });

  test('the "Selector Playground" entry-point trigger is still present in source', () => {
    const source = readPlaygroundSource();
    expect(source).toMatch(/Selector Playground/);
  });

  test("exposes exactly the 16 locked selector destinations, each declared exactly once", () => {
    const source = readPlaygroundSource();
    const sourceFile = parsePlayground(source);

    const foundFields: string[] = [];
    function visit(node: import("typescript").Node) {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === "selectorFields" &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const element of node.initializer.elements) {
          if (ts.isObjectLiteralExpression(element)) {
            for (const prop of element.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                prop.name.getText() === "field" &&
                ts.isStringLiteral(prop.initializer)
              ) {
                foundFields.push(prop.initializer.text);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    expect(foundFields.length).toBe(REQUIRED_SELECTOR_DESTINATIONS.length);
    expect(new Set(foundFields).size).toBe(foundFields.length);
    expect(new Set(foundFields)).toEqual(new Set(REQUIRED_SELECTOR_DESTINATIONS));
  });
});

// ---------------------------------------------------------------------------
// Anti-bypass — allow-same-origin must never reappear anywhere in the
// playground's iframe construction, statically or dynamically constructed.
// ---------------------------------------------------------------------------

describe('Selector Playground iframe sandbox — "allow-same-origin" must never reappear (anti-bypass)', () => {
  test('no file under frontend/src contains the literal string "allow-same-origin"', () => {
    const files = discoverFilesRecursive(
      FRONTEND_SRC,
      /\.(tsx?|jsx?)$/,
      new Set(["node_modules"]),
    );
    const offenders = files.filter((file) => readFileSync(file, "utf8").includes("allow-same-origin"));
    expect(offenders).toEqual([]);
  });

  test("the playground iframe's sandbox attribute grants allow-scripts without allow-same-origin", () => {
    const source = readPlaygroundSource();
    const sourceFile = parsePlayground(source);

    let sandboxValue: string | null = null;
    function visit(node: import("typescript").Node) {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText() === "sandbox" &&
        node.initializer
      ) {
        if (ts.isStringLiteral(node.initializer)) {
          sandboxValue = node.initializer.text;
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          ts.isStringLiteral(node.initializer.expression)
        ) {
          sandboxValue = node.initializer.expression.text;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    expect(sandboxValue).not.toBeNull();
    expect(sandboxValue).toMatch(/(^|\s)allow-scripts(\s|$)/);
    expect(sandboxValue).not.toContain("allow-same-origin");
  });
});
