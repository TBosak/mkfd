import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the protected-value boundary half of requirement 7 in the
// `p1-static-diagnostics-cleanup` brief: "Protected values are resolved
// only through existing protected-value boundaries - never cast to
// plaintext strings." Strict-mode/typecheck fixes elsewhere in this slice
// narrow `unknown`/`null`/union values at real boundaries; the one escape
// that would make a `ProtectedValue` (`utilities/protected-values.utility.ts`,
// `models/protected-value.model.ts`) typecheck without actually resolving it
// is `somePv as string` (or `(x as ProtectedValue).value as string`) -
// bypassing `resolveProtectedValue`/`resolveProtectedValues` entirely and
// leaking an encrypted/env-reference payload where plaintext is expected.
//
// This uses the real TypeScript compiler API and type checker (the same
// borrowed local `typescript` install other suites in this repo use) rather
// than a text regex, so it is robust to formatting and does not depend on a
// literal variable name. It is scoped to root application files that
// reference `ProtectedValue` (pre-filtered by disk content for speed - a
// program-wide walk is unnecessary since only those files can contain a
// `ProtectedValue`-typed expression).
//
// Detection covers both single and nested/container casts: a direct
// `pv as string`, a double-cast escape `pv as unknown as string`, AND a
// *container* cast such as `resolveProtectedValues(fields, opts) as
// Record<string, string>` where the source expression's real type is
// `Record<string, ProtectedValue>` (or `ProtectedRecord`) and the target is
// `string` or a string-valued object/Record type. The check walks through
// any chain of `as` casts to the original, non-cast expression and asks the
// type checker for THAT expression's real type, so `X as unknown as Y` and
// `X as Y` are judged identically by the same rule.
//
// This currently fails for a real, already-present diagnostic:
// `utilities/service-connector-runner.utility.ts` casts the result of
// `resolveProtectedValues(config.connection.auth.fields, ...)` - whose
// inferred type is still `Record<string, ProtectedValue>` because
// `resolveProtectedValues`'s generic signature does not narrow `T` at the
// value level - directly `as Record<string, string>`. That single cast is
// exactly the "neither type sufficiently overlaps" TS2352 diagnostic
// contributing to the current `bun run typecheck:root` RED baseline. This
// test intentionally treats that cast as a violation regardless of whether
// it happens to be safe at runtime today (the call already resolved the
// values): allowing it here would also allow a *future*, truly-unresolved
// direct cast at the same call site to slip through unnoticed, and the
// brief's requirement 7 explicitly wants the boundary narrowed at its
// declaration (e.g. a mapped-type return on `resolveProtectedValues`)
// rather than cast away at each call site.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const ts = require(join(REPO_ROOT, "frontend/node_modules/typescript")) as typeof import("typescript");

function readParsedConfig(configPath: string, basePath: string) {
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(readResult.error, `failed to read ${configPath}`).toBeUndefined();
  return ts.parseJsonConfigFileContent(readResult.config, ts.sys, basePath);
}

interface PlaintextCast {
  file: string;
  line: number;
  text: string;
}

/**
 * True if `typeNode`'s text denotes "plain string" or a string-valued
 * container: the `string` keyword, `Record<string, string>` (any spacing),
 * or a `{ [key: string]: string }` index-signature object literal whose
 * only member(s) are string-valued index signatures. This is deliberately
 * conservative (textual/shape-based, not exhaustive over every possible
 * string-container spelling) - it only needs to catch the shapes a real fix
 * would plausibly write, not every theoretically expressible one.
 */
function isStringOrStringContainerTarget(
  typeNode: import("typescript").TypeNode,
  sourceFile: import("typescript").SourceFile,
): boolean {
  const text = typeNode.getText(sourceFile).replace(/\s+/g, "");
  if (text === "string") return true;
  if (/^Record<string,string>$/.test(text)) return true;
  if (ts.isTypeLiteralNode(typeNode)) {
    const members = typeNode.members;
    if (
      members.length > 0 &&
      members.every(
        (m) => ts.isIndexSignatureDeclaration(m) && (m.type?.getText(sourceFile).replace(/\s+/g, "") ?? "") === "string",
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Peels through a chain of `as` casts (`X as A as B`, i.e. `X as unknown as B`) down to the original, non-cast expression. */
function unwrapCastChain(node: import("typescript").Expression): import("typescript").Expression {
  let current = node;
  while (ts.isAsExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Finds every `as`-cast (single or nested/double) in `fileName` where the
 * asserted target is `string` or a string-valued container, and the real
 * type of the ORIGINAL (pre-cast) expression - resolved via the type
 * checker, not the immediate `as unknown` intermediate type - mentions
 * `ProtectedValue` or `ProtectedRecord`. Only the outermost `AsExpression`
 * of a chain is reported (an inner `X as unknown` node is also visited
 * independently by the walk, but its own target type is `unknown`, which
 * never matches `isStringOrStringContainerTarget`, so it can't double-report).
 */
function findProtectedValuePlaintextCasts(program: import("typescript").Program, fileName: string): PlaintextCast[] {
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return [];
  const checker = program.getTypeChecker();
  const violations: PlaintextCast[] = [];

  function visit(node: import("typescript").Node) {
    if (ts.isAsExpression(node) && isStringOrStringContainerTarget(node.type, sourceFile as import("typescript").SourceFile)) {
      const originalExpression = unwrapCastChain(node.expression);
      const sourceType = checker.getTypeAtLocation(originalExpression);
      const typeName = checker.typeToString(sourceType);
      if (/\bProtectedValue\b/.test(typeName) || /\bProtectedRecord\b/.test(typeName)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({ file: fileName, line: line + 1, text: node.getText(sourceFile) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

describe("findProtectedValuePlaintextCasts helper correctness (fixture program, not the real source tree)", () => {
  function buildFixtureProgram(source: string): import("typescript").Program {
    const fileName = "/fixture.ts";
    const modelFileName = "/protected-value.model.ts";
    const modelSource = `
      export type ProtectedValue =
        | { type: "protected"; value: string }
        | { type: "env"; value: string; prefix?: string; suffix?: string };
      export type ProtectedRecord = Record<string, string | ProtectedValue>;
    `;
    const host = ts.createCompilerHost({});
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersionOrOptions, ...rest) => {
      if (name === fileName) return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
      if (name === modelFileName) return ts.createSourceFile(modelFileName, modelSource, ts.ScriptTarget.Latest, true);
      return originalGetSourceFile(name, languageVersionOrOptions, ...rest);
    };
    return ts.createProgram({
      rootNames: [fileName],
      options: { strict: true, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true },
      host,
    });
  }

  test("flags a direct 'pv as string' cast of a ProtectedValue-typed parameter", () => {
    const program = buildFixtureProgram(`
      import type { ProtectedValue } from "/protected-value.model.ts";
      function leak(pv: ProtectedValue): string {
        return pv as string;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toHaveLength(1);
  });

  test("does not flag resolving through resolveProtectedValue-shaped code (no direct cast)", () => {
    const program = buildFixtureProgram(`
      import type { ProtectedValue } from "/protected-value.model.ts";
      declare function resolveProtectedValue(pv: ProtectedValue, key: string): string;
      function ok(pv: ProtectedValue, key: string): string {
        return resolveProtectedValue(pv, key);
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toEqual([]);
  });

  test("does not flag an unrelated 'as string' cast on a plain string/number value", () => {
    const program = buildFixtureProgram(`
      function ok(x: unknown): string {
        return x as string;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toEqual([]);
  });

  test("flags the double-cast escape 'pv as unknown as string' (not just the direct single-cast form)", () => {
    const program = buildFixtureProgram(`
      import type { ProtectedValue } from "/protected-value.model.ts";
      function leak(pv: ProtectedValue): string {
        return pv as unknown as string;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toHaveLength(1);
    expect(violations[0].text).toBe("pv as unknown as string");
  });

  test("flags a direct container cast 'Record<string, ProtectedValue> as Record<string, string>' (the real service-connector-runner.utility.ts shape)", () => {
    const program = buildFixtureProgram(`
      import type { ProtectedValue } from "/protected-value.model.ts";
      function leak(fields: Record<string, ProtectedValue>): Record<string, string> {
        return fields as Record<string, string>;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toHaveLength(1);
  });

  test("flags a double-cast container escape 'fields as unknown as Record<string, string>'", () => {
    const program = buildFixtureProgram(`
      import type { ProtectedValue } from "/protected-value.model.ts";
      function leak(fields: Record<string, ProtectedValue>): Record<string, string> {
        return fields as unknown as Record<string, string>;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toHaveLength(1);
  });

  test("flags a cast through the 'ProtectedRecord' alias, not just the literal 'ProtectedValue' union", () => {
    const program = buildFixtureProgram(`
      import type { ProtectedRecord } from "/protected-value.model.ts";
      function leak(fields: ProtectedRecord): Record<string, string> {
        return fields as unknown as Record<string, string>;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toHaveLength(1);
  });

  test("does not flag a container cast whose source has nothing to do with ProtectedValue", () => {
    const program = buildFixtureProgram(`
      function ok(fields: Record<string, unknown>): Record<string, string> {
        return fields as Record<string, string>;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toEqual([]);
  });

  test("does not flag an 'as unknown as' escape whose final target is not string-shaped (out of this check's scope)", () => {
    const program = buildFixtureProgram(`
      import type { ProtectedValue } from "/protected-value.model.ts";
      function ok(pv: ProtectedValue): number {
        return pv as unknown as number;
      }
    `);
    const violations = findProtectedValuePlaintextCasts(program, "/fixture.ts");
    expect(violations).toEqual([]);
  });
});

describe("no root application file casts a ProtectedValue/ProtectedRecord (directly, nested, or as a container) to a plaintext string (requirement 7)", () => {
  const parsed = readParsedConfig(join(REPO_ROOT, "tsconfig.json"), REPO_ROOT);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

  // Pre-filtered by disk content for speed: only a file that mentions
  // ProtectedValue or ProtectedRecord at all can possibly contain a
  // ProtectedValue/ProtectedRecord-typed cast. Both substrings are checked -
  // some files (e.g. models/graphql.model.ts) reference only
  // `ProtectedRecord` and never spell out `ProtectedValue` themselves.
  const candidateFiles = parsed.fileNames.filter((fileName) => {
    if (fileName.includes("/node_modules/")) return false;
    try {
      const source = readFileSync(fileName, "utf8");
      return source.includes("ProtectedValue") || source.includes("ProtectedRecord");
    } catch {
      return false;
    }
  });

  test("at least one candidate file referencing ProtectedValue is discovered (prerequisite)", () => {
    expect(candidateFiles.length).toBeGreaterThan(0);
  });

  test(
    "zero casts resolve a ProtectedValue/ProtectedRecord-typed expression to a string or string-valued container, across all candidate files",
    () => {
      const violations = candidateFiles.flatMap((fileName) => findProtectedValuePlaintextCasts(program, fileName));
      const report = violations.map((v) => `${v.file.replace(REPO_ROOT, "")}:${v.line} ${v.text}`);
      expect(report, report.join("\n")).toEqual([]);
    },
    60_000,
  );
});
