import { describe, test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies requirement 5 of the `p1-static-diagnostics-cleanup` brief:
// "Hook dependency fixes preserve intended lifecycle behavior and do not
// introduce request/render loops, duplicate submissions, or unstable
// listener cleanup."
//
// The two current `useExhaustiveDependencies` errors
// (frontend/src/components/settings/RequestProfilesPanel.tsx and
// frontend/src/pages/catalog/CommunityCatalogPage.tsx) are both
// `useEffect(() => { load(); }, []);` mount-only data loads where `load`
// is a plain (non-memoized) function redefined on every render. The
// mechanical Biome-suggested fix - add `load` to the dependency array - is
// exactly the trap this requirement warns about: adding an unmemoized
// function to a dependency array gives it a new identity every render,
// so the effect (and therefore the fetch) reruns on *every* render
// instead of once on mount, i.e. exactly the "request loop" / "duplicate
// submissions" regression called out by the brief.
//
// This suite uses the real TypeScript compiler API AND its type checker
// (the same borrowed local `typescript` install used elsewhere in this
// repo) to resolve each dependency-array identifier to its actual bound
// declaration via `checker.getSymbolAtLocation` - genuine scope-aware
// symbol resolution, not a whole-file name-string search. That specifically
// fixes two correctness requirements from review:
//   1. A `function loadOnce() {}` declared at MODULE scope (outside any
//      component/hook) is stable across renders by construction and must
//      not be flagged, even though it is a "plain function" the same way a
//      component-local one is.
//   2. A `useCallback` wrapping some OTHER, differently-scoped binding that
//      happens to share the same name must never be treated as stabilizing
//      THIS identifier - symbol resolution makes that confusion structurally
//      impossible, since two different bindings are two different symbols
//      no matter what they're named.
// It is deliberately implementation-agnostic: it does not require *which*
// two effects get fixed, only that wherever a hook effect ends up depending
// on a function, that function is stable. It also does not require RED
// today (both current effects have an *empty* dependency array - the
// naive/unsafe fix exists only after someone adds `load`/`loadCatalog`
// without stabilizing it), so it acts as a forward guard against the naive
// fix, pairing with the zero-error architecture proof that today's missing
// dependency itself must be resolved.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const FRONTEND_SRC = join(FRONTEND_DIR, "src");
// Dynamic require of the one locally installed TypeScript copy (test infrastructure, not application code).
const ts = require(join(FRONTEND_DIR, "node_modules/typescript")) as typeof import("typescript");

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

/**
 * Builds a single-file `ts.Program` for `fileName`/`source`, without
 * resolving any external imports (e.g. "react"). Symbol resolution for
 * LOCAL declarations (function/variable bindings within the same file) is
 * unaffected by unresolved external imports - TS binds local scopes from
 * the parse tree directly - so this is sufficient for scope-aware analysis
 * of dependency-array identifiers without needing the full frontend
 * dependency graph resolved (which would be far slower to build repeatedly).
 */
function createSingleFileProgram(fileName: string, source: string): import("typescript").Program {
  const host = ts.createCompilerHost({});
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersionOrOptions, ...rest) => {
    if (name === fileName) {
      return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    }
    return originalGetSourceFile(name, languageVersionOrOptions, ...rest);
  };
  return ts.createProgram({
    rootNames: [fileName],
    options: {
      strict: true,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
    },
    host,
  });
}

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect"]);

interface UnstableDependency {
  effectHook: string;
  identifier: string;
  line: number;
}

/** True if `declaration`'s nearest enclosing scope is the module (source file) top level - i.e. NOT nested inside any function/arrow, and therefore stable across every render by construction. */
function isModuleScopeDeclaration(declaration: import("typescript").Node): boolean {
  let current: import("typescript").Node | undefined = declaration.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return false;
    }
    if (ts.isSourceFile(current)) return true;
    current = current.parent;
  }
  return true;
}

/** True if `declaration` is `const name = useCallback(...)` - a memoized, stable-identity binding. */
function isUseCallbackDeclaration(declaration: import("typescript").Node): boolean {
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false;
  const init = declaration.initializer;
  return ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "useCallback";
}

/** True if `declaration` is itself a function-valued binding: a function declaration, an arrow/function-expression initializer, or a `useCallback(...)` call initializer. Non-function bindings (state, primitives, refs) are out of scope for this check entirely. */
function isFunctionValuedDeclaration(declaration: import("typescript").Node): boolean {
  if (ts.isFunctionDeclaration(declaration)) return true;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const init = declaration.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return true;
    if (isUseCallbackDeclaration(declaration)) return true;
  }
  return false;
}

/**
 * Finds every `useEffect`/`useLayoutEffect` call whose dependency array
 * references a function-valued identifier that is neither module-scope nor
 * wrapped in `useCallback`. Such an identifier gets a new reference every
 * render, so including it in a dependency array defeats the array's entire
 * purpose and reruns the effect on every render instead of once on mount.
 * Resolution is via the type checker's symbol table (see file header) -
 * genuinely scope-correct, not a name-string search.
 */
function findUnstableEffectDependencies(
  program: import("typescript").Program,
  sourceFile: import("typescript").SourceFile,
): UnstableDependency[] {
  const checker = program.getTypeChecker();
  const violations: UnstableDependency[] = [];

  function lineOf(node: import("typescript").Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node: import("typescript").Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && EFFECT_HOOK_NAMES.has(node.expression.text)) {
      const depsArg = node.arguments[1];
      if (depsArg && ts.isArrayLiteralExpression(depsArg)) {
        for (const element of depsArg.elements) {
          if (!ts.isIdentifier(element)) continue;
          const symbol = checker.getSymbolAtLocation(element);
          const declaration = symbol?.valueDeclaration;
          if (!declaration) continue;
          if (!isFunctionValuedDeclaration(declaration)) continue;
          if (isModuleScopeDeclaration(declaration)) continue;
          if (isUseCallbackDeclaration(declaration)) continue;
          violations.push({ effectHook: node.expression.text, identifier: element.text, line: lineOf(node) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

// --------------------------- helper-correctness unit tests ---------------------------

describe("findUnstableEffectDependencies helper correctness (fixtures, not the real source tree)", () => {
  function violationsOf(componentBody: string): UnstableDependency[] {
    const fileName = "/fixture.tsx";
    const source = `import { useEffect, useLayoutEffect, useCallback } from "react";\nfunction Fixture() {\n${componentBody}\n}\n`;
    const program = createSingleFileProgram(fileName, source);
    return findUnstableEffectDependencies(program, program.getSourceFile(fileName) as import("typescript").SourceFile);
  }

  function violationsOfModule(moduleBody: string): UnstableDependency[] {
    const fileName = "/fixture.tsx";
    const source = `import { useEffect, useLayoutEffect, useCallback } from "react";\n${moduleBody}\n`;
    const program = createSingleFileProgram(fileName, source);
    return findUnstableEffectDependencies(program, program.getSourceFile(fileName) as import("typescript").SourceFile);
  }

  test("flags an unmemoized COMPONENT-LOCAL function added to a useEffect dependency array (the naive/unsafe fix)", () => {
    const violations = violationsOf(`
      const load = async () => { await fetch("/x"); };
      useEffect(() => { load(); }, [load]);
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0].identifier).toBe("load");
    expect(violations[0].effectHook).toBe("useEffect");
  });

  test("does not flag a useCallback-wrapped function in the dependency array (the safe fix)", () => {
    const violations = violationsOf(`
      const load = useCallback(async () => { await fetch("/x"); }, []);
      useEffect(() => { load(); }, [load]);
    `);
    expect(violations).toEqual([]);
  });

  test("does not flag an effect with an empty dependency array (today's actual, pre-fix state)", () => {
    const violations = violationsOf(`
      const load = async () => { await fetch("/x"); };
      useEffect(() => { load(); }, []);
    `);
    expect(violations).toEqual([]);
  });

  test("does not flag a non-function identifier (e.g. state) in the dependency array", () => {
    const violations = violationsOf(`
      const [count, setCount] = [0, (_: number) => {}];
      useEffect(() => { setCount(count + 1); }, [count]);
    `);
    expect(violations).toEqual([]);
  });

  test("flags an unstable function used via useLayoutEffect, not only useEffect", () => {
    const violations = violationsOf(`
      const measure = () => { return 1; };
      useLayoutEffect(() => { measure(); }, [measure]);
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0].effectHook).toBe("useLayoutEffect");
  });

  test("does not flag an async function declaration form (not just arrow) once useCallback-wrapped", () => {
    const violations = violationsOf(`
      const loadCatalog = useCallback(async function () { await fetch("/y"); }, []);
      useEffect(() => { loadCatalog(); }, [loadCatalog]);
    `);
    expect(violations).toEqual([]);
  });

  // --- review counterexample: module-scope stability ---

  test("REVIEW COUNTEREXAMPLE: does not flag a MODULE-SCOPE 'function loadOnce() {}' used in a dependency array (stable by construction, no useCallback needed)", () => {
    const violations = violationsOfModule(`
      function loadOnce() {}
      function Component() {
        useEffect(() => { loadOnce(); }, [loadOnce]);
        return null;
      }
    `);
    expect(violations).toEqual([]);
  });

  test("REVIEW COUNTEREXAMPLE: does not flag a module-scope 'const' arrow function used in a dependency array", () => {
    const violations = violationsOfModule(`
      const loadOnce = () => {};
      function Component() {
        useEffect(() => { loadOnce(); }, [loadOnce]);
        return null;
      }
    `);
    expect(violations).toEqual([]);
  });

  // --- review counterexample: a same-named useCallback in a different scope must not "stabilize" an unrelated local ---

  test("REVIEW COUNTEREXAMPLE: a useCallback-wrapped 'load' in a DIFFERENT, unrelated component does not stabilize this component's own unmemoized 'load'", () => {
    const violations = violationsOfModule(`
      function Other() {
        const load = useCallback(() => {}, []);
        useEffect(() => { load(); }, [load]);
        return null;
      }
      function Component() {
        const load = () => {};
        useEffect(() => { load(); }, [load]);
        return null;
      }
    `);
    // Component's own "load" (component-local, NOT useCallback-wrapped) must
    // still be flagged - a naive whole-file name search would find Other's
    // "const load = useCallback(...)" and incorrectly treat Component's
    // "load" as stabilized too, since both share the name "load".
    expect(violations).toHaveLength(1);
    expect(violations[0].identifier).toBe("load");
  });
});

// --------------------------- real frontend/src scan ---------------------------

// A single shared `ts.Program` built once from the real `frontend/tsconfig.json`
// (the same pattern `tests/static-quality-typescript-config.test.ts` and
// `tests/protected-value-cast-boundary.test.ts` use), rather than one fresh
// single-file program per discovered file: building ~100 independent
// programs (each re-binding the default lib from scratch) is what made an
// earlier version of this scan time out. One shared program still gives
// `checker.getSymbolAtLocation` everything it needs for LOCAL scope
// resolution, and is dramatically cheaper to build once.
function readParsedConfig(configPath: string, basePath: string) {
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(readResult.error, `failed to read ${configPath}`).toBeUndefined();
  return ts.parseJsonConfigFileContent(readResult.config, ts.sys, basePath);
}

describe("no frontend/src effect depends on an unmemoized, component-local function (requirement 5)", () => {
  const files = discoverFilesRecursive(FRONTEND_SRC, /\.tsx?$/, new Set(["node_modules"]));

  test("at least one frontend/src file is discovered (prerequisite)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test(
    "zero useEffect/useLayoutEffect dependency arrays reference a non-module-scope, non-useCallback function",
    () => {
      const parsed = readParsedConfig(join(FRONTEND_DIR, "tsconfig.json"), FRONTEND_DIR);
      const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
      const normalizedTargets = new Set(files.map((f) => f.replaceAll("\\", "/")));

      const violations: string[] = [];
      for (const fileName of program.getSourceFiles().map((sf) => sf.fileName)) {
        if (!normalizedTargets.has(fileName.replaceAll("\\", "/"))) continue;
        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile) continue;
        for (const v of findUnstableEffectDependencies(program, sourceFile)) {
          const relPath = fileName.replace(REPO_ROOT, "").replaceAll("\\", "/");
          violations.push(`${relPath}:${v.line} ${v.effectHook}([..., ${v.identifier}, ...])`);
        }
      }
      expect(violations, violations.join("\n")).toEqual([]);
    },
    120_000,
  );
});
