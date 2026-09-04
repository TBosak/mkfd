import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies requirement 4 of the `p1-static-diagnostics-cleanup` brief:
// "Frontend accessibility errors are repaired semantically" - not merely
// silenced. Biome's own a11y rules (useButtonType, noLabelWithoutControl,
// useKeyWithClickEvents/noStaticElementInteractions, noSvgWithoutTitle) are
// already specified as "must reach zero" by the architecture suite, but a
// rule can be satisfied by a technically-valid yet semantically-empty fix
// (e.g. `role="button"` with no `tabIndex`, so a mouse user can click it but
// a keyboard user can never even focus it). This suite parses the *real*
// frontend/src TSX source with the TypeScript compiler API (borrowing the
// one local `typescript` install under frontend/node_modules, exactly as
// `tests/static-quality-typescript-config.test.ts` already does) and checks
// the actual accessible-semantics contract Biome's own rules do not fully
// verify - discovered from disk, not a hard-coded file list, so it also
// guards future regressions, not just today's known violations.
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

// --------------------------- JSX attribute extraction ---------------------------

type AttrValue =
  | { kind: "boolean" }
  | { kind: "string"; value: string }
  | { kind: "expression"; text: string; node: import("typescript").Expression };

type JsxAttrMap = Map<string, AttrValue>;

function extractAttributes(attributes: import("typescript").JsxAttributes): JsxAttrMap {
  const map: JsxAttrMap = new Map();
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop)) continue; // skip {...spread} attributes; can't statically resolve them
    const name = prop.name.getText();
    const initializer = prop.initializer;
    if (!initializer) {
      map.set(name, { kind: "boolean" });
    } else if (ts.isStringLiteral(initializer)) {
      map.set(name, { kind: "string", value: initializer.text });
    } else if (ts.isJsxExpression(initializer) && initializer.expression) {
      map.set(name, { kind: "expression", text: initializer.expression.getText(), node: initializer.expression });
    } else {
      map.set(name, { kind: "boolean" });
    }
  }
  return map;
}

function attrPresentNonEmpty(attrs: JsxAttrMap, name: string): boolean {
  const value = attrs.get(name);
  if (!value) return false;
  if (value.kind === "string") return value.value.trim().length > 0;
  return true; // boolean/expression: presence is the best static signal available
}

type JsxContainerNode = import("typescript").JsxElement | import("typescript").JsxSelfClosingElement;

interface JsxElementInfo {
  tagName: string;
  attrs: JsxAttrMap;
  line: number;
  node: JsxContainerNode;
  hasDescendantTag: (tagNames: Set<string>) => boolean;
}

function collectJsxElements(sourceFile: import("typescript").SourceFile): JsxElementInfo[] {
  const results: JsxElementInfo[] = [];

  function descendantHasTag(node: import("typescript").Node, tagNames: Set<string>): boolean {
    let found = false;
    function visit(inner: import("typescript").Node) {
      if (found) return;
      if (ts.isJsxOpeningElement(inner) || ts.isJsxSelfClosingElement(inner)) {
        if (tagNames.has(inner.tagName.getText())) {
          found = true;
          return;
        }
      }
      ts.forEachChild(inner, visit);
    }
    ts.forEachChild(node, visit);
    return found;
  }

  function lineOf(node: import("typescript").Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node: import("typescript").Node) {
    if (ts.isJsxElement(node)) {
      results.push({
        tagName: node.openingElement.tagName.getText(),
        attrs: extractAttributes(node.openingElement.attributes),
        line: lineOf(node.openingElement),
        node,
        hasDescendantTag: (tagNames) => descendantHasTag(node, tagNames),
      });
    } else if (ts.isJsxSelfClosingElement(node)) {
      results.push({
        tagName: node.tagName.getText(),
        attrs: extractAttributes(node.attributes),
        line: lineOf(node),
        node,
        hasDescendantTag: () => false,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return results;
}

// The standard set of native HTML "labelable elements" per the HTML spec's
// implicit label-association algorithm: button, input, meter, output,
// progress, select, textarea. (An `<input type="hidden">` is technically
// excluded from the spec's own definition, but this suite's fixtures
// deliberately never use a hidden input as a *positive* example - a hidden
// input isn't a meaningful accessibility demonstration either way.)
const NATIVE_LABELABLE_CONTROLS = new Set(["button", "input", "meter", "output", "progress", "select", "textarea"]);

// The custom (non-native) React components this app defines that this
// suite deliberately treats as valid `htmlFor`/`id` association targets,
// because they forward a supplied `id` onto their own underlying
// interactive element: `Checkbox` (frontend/src/components/ui/checkbox.tsx)
// wraps `@radix-ui/react-checkbox`'s `Root`, which renders a real
// `<button role="checkbox">` and spreads `{...props}` (including `id`) onto
// it. A plain layout/structural component (e.g. `<div id="panel">`) is
// deliberately NOT in this set - see the review counterexample.
const SUPPORTED_CUSTOM_CONTROL_TAGS = new Set(["Checkbox"]);
const LABELABLE_TAGS = new Set([...NATIVE_LABELABLE_CONTROLS, ...SUPPORTED_CUSTOM_CONTROL_TAGS]);

/** Walks up from `node` to the nearest enclosing function-like ancestor (the component/hook body that renders it), or the source file itself if there is none. This is the "ownership tree" a label and its associated control must share - two different top-level components in the same file must NOT be treated as one shared id namespace. */
function findEnclosingFunctionLike(node: import("typescript").Node): import("typescript").Node {
  let current: import("typescript").Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

/**
 * Collects every literal string `id="..."` attribute value declared on a
 * LABELABLE element (native `input`/`select`/`textarea`, or a supported
 * custom control tag) anywhere within `scope` - deliberately excluding
 * non-labelable elements like `<div id="panel">` (see the review
 * counterexample `<label htmlFor="panel">Name</label><div id="panel" />`,
 * which must NOT be treated as a valid association) and deliberately
 * scoped to a single component/function body, not the whole file (see the
 * review counterexample of two components sharing an id by coincidence).
 */
function collectLabelableIdsWithin(scope: import("typescript").Node): Set<string> {
  const ids = new Set<string>();
  function visit(node: import("typescript").Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (LABELABLE_TAGS.has(node.tagName.getText())) {
        const attrs = extractAttributes(node.attributes);
        const idAttr = attrs.get("id");
        if (idAttr?.kind === "string") ids.add(idAttr.value);
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(scope, visit);
  return ids;
}

function elementInnerText(el: import("typescript").JsxElement): string {
  return el.children
    .filter(ts.isJsxText)
    .map((t) => t.text)
    .join("")
    .trim();
}

/**
 * Finds the first descendant of `rootNode` with a literal `id` attribute
 * equal to `id`, and returns its JSX text content (trimmed), or `null` if no
 * such descendant exists. Used to validate that a literal
 * `aria-labelledby="x"` actually resolves to a nonempty labelling element
 * within the same inline SVG.
 */
function findDescendantTextById(rootNode: import("typescript").Node, id: string): string | null {
  let result: string | null = null;
  function visit(node: import("typescript").Node) {
    if (result !== null) return;
    if (ts.isJsxElement(node)) {
      const attrs = extractAttributes(node.openingElement.attributes);
      const idAttr = attrs.get("id");
      if (idAttr?.kind === "string" && idAttr.value === id) {
        result = elementInnerText(node);
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(rootNode, visit);
  return result;
}

/** True if any whitespace-separated token in a literal `aria-labelledby` value resolves to a descendant with nonempty text - the standard `aria-labelledby` semantics treat the attribute as a space-separated ID list, not one single ID, and only one referenced element needs to contribute a nonempty name. */
function anyLabelledByTokenResolves(rootNode: import("typescript").Node, value: string): boolean {
  return value
    .trim()
    .split(/\s+/)
    .some((id) => {
      const text = findDescendantTextById(rootNode, id);
      return text !== null && text.length > 0;
    });
}

/** True if `el` is a `<svg>` JsxElement (not self-closing) with a direct child `<title>` whose text content is nonempty - the native SVG accessible-name mechanism, valid on its own without any `aria-*` attribute. */
function hasDirectNonEmptyTitleChild(el: JsxElementInfo): boolean {
  if (!ts.isJsxElement(el.node)) return false; // a self-closing <svg /> can have no children at all
  for (const child of el.node.children) {
    if (ts.isJsxElement(child) && child.openingElement.tagName.getText() === "title") {
      if (elementInnerText(child).length > 0) return true;
    }
  }
  return false;
}

function parseSource(fileName: string, text: string): import("typescript").SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// --------------------------- semantic predicates under test ---------------------------

const VALID_BUTTON_TYPES = new Set(["button", "submit", "reset"]);

/** Flags a `<button>` with no `type`, a valueless `type`, or a literal `type` that isn't one of the three standard values (e.g. `type=""` - present but not actually valid). A dynamic (non-literal) `type` is accepted conservatively. */
function isMissingExplicitButtonType(el: JsxElementInfo): boolean {
  if (el.tagName !== "button") return false;
  const type = el.attrs.get("type");
  if (!type || type.kind === "boolean") return true;
  if (type.kind === "string") return !VALID_BUTTON_TYPES.has(type.value.trim());
  return false; // dynamic expression - conservatively accept
}

/**
 * Flags an `<svg>` that is neither hidden from assistive tech
 * (`aria-hidden="true"`) nor given a real accessible name. Any of the
 * following counts as a real accessible name: a nonempty `aria-label`; a
 * literal `aria-labelledby` (a whitespace-separated ID list per the standard
 * `aria-labelledby` semantics - at least one token must resolve to a
 * descendant with nonempty text; a dangling/broken reference on its own is
 * treated the same as having no accessible name at all); or a direct,
 * nonempty `<title>` child (the native SVG accessible-name mechanism,
 * valid on its own without any `aria-*` attribute - requiring
 * `aria-labelledby` in addition would overconstrain a perfectly valid
 * semantic fix). A dynamic (non-literal) `aria-labelledby` is accepted
 * conservatively, since its target can't be resolved statically.
 */
function isSvgWithoutAccessibleNameOrHiddenState(el: JsxElementInfo): boolean {
  if (el.tagName !== "svg") return false;
  const ariaHidden = el.attrs.get("aria-hidden");
  const isHidden =
    !!ariaHidden &&
    ((ariaHidden.kind === "string" && ariaHidden.value === "true") ||
      (ariaHidden.kind === "expression" && ariaHidden.text === "true") ||
      ariaHidden.kind === "boolean");
  if (isHidden) return false;
  if (attrPresentNonEmpty(el.attrs, "aria-label")) return false;

  const labelledBy = el.attrs.get("aria-labelledby");
  if (labelledBy) {
    if (labelledBy.kind === "expression") return false; // dynamic reference - conservatively accept
    if (labelledBy.kind === "string" && labelledBy.value.trim().length > 0) {
      if (anyLabelledByTokenResolves(el.node, labelledBy.value)) return false;
    }
  }

  if (hasDirectNonEmptyTitleChild(el)) return false;

  return true;
}

/**
 * Flags a `<label>` with no valid accessible association: it neither
 * directly wraps a NATIVE labelable control (the browser's own implicit
 * label-association algorithm only recognizes real `input`/`select`/
 * `textarea` elements - wrapping a custom component like `<Checkbox>` alone,
 * with no `htmlFor`, is NOT sufficient; that is exactly why Biome itself
 * currently flags the real `CalendarForm.tsx`/`FilesystemForm.tsx`/
 * `WebhookFeedForm.tsx` labels, which wrap `<Checkbox>` with no `htmlFor` at
 * all), nor has an `htmlFor` that resolves to a matching `id` on a labelable
 * element (native, OR an explicitly supported custom control - an explicit
 * `htmlFor`/`id` pair is a real, working association regardless of whether
 * the target is native) declared WITHIN THE SAME enclosing component/
 * function - not merely anywhere in the file (see the review's two
 * counterexamples: a matching id on a non-labelable `<div>`, and a matching
 * id that only exists in a different, unrelated component). A literal
 * `htmlFor` must literally match a literal `id` on a labelable target (see
 * the earlier review counterexample
 * `<label htmlFor="typo">Name</label><input id="actual" />` - "any nonempty
 * htmlFor" is not enough). A dynamic (non-literal) `htmlFor` is accepted
 * conservatively, since its target can't be resolved statically.
 */
function isLabelWithoutValidAssociation(el: JsxElementInfo): boolean {
  if (el.tagName !== "label") return false;
  if (el.hasDescendantTag(NATIVE_LABELABLE_CONTROLS)) return false;

  const htmlFor = el.attrs.get("htmlFor");
  if (!htmlFor || htmlFor.kind === "boolean") return true; // no association, or a valueless htmlFor
  if (htmlFor.kind === "expression") return false; // dynamic - conservatively accept
  const value = htmlFor.value.trim();
  if (value.length === 0) return true;
  const scope = findEnclosingFunctionLike(el.node);
  return !collectLabelableIdsWithin(scope).has(value);
}

const NON_INTERACTIVE_CLICKABLE_TAGS = new Set(["div", "span"]);
const KEY_HANDLER_ATTR_NAMES = ["onKeyDown", "onKeyUp", "onKeyPress"] as const;

// WAI-ARIA widget roles that support click activation and standard
// Enter/Space keyboard activation - an explicit allowlist, not a denylist:
// `role="img"`, `role="heading"`, `role="status"`, a typo, or any other
// non-interactive/landmark/structure role must still be flagged even though
// it isn't one of the specifically-known-bad "presentation"/"none" values.
const INTERACTIVE_ROLE_VALUES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
]);

function hasAppropriateInteractiveRole(attrs: JsxAttrMap): boolean {
  const role = attrs.get("role");
  if (!role || role.kind === "boolean") return false;
  if (role.kind === "string") return INTERACTIVE_ROLE_VALUES.has(role.value.trim());
  return !/presentation|none/i.test(role.text); // dynamic - reject only the obviously-inert case, accept conservatively otherwise
}

/** Rejects a negative (keyboard-unreachable) tabIndex; accepts non-numeric/dynamic values conservatively (can't statically resolve them). */
function isKeyboardReachableTabIndex(attrs: JsxAttrMap): boolean {
  const value = attrs.get("tabIndex");
  if (!value || value.kind === "boolean") return false; // tabIndex requires an explicit value
  const raw = (value.kind === "string" ? value.value : value.text).trim();
  const num = Number(raw);
  if (Number.isNaN(num)) return true; // dynamic/non-literal-numeric - can't statically verify, accept conservatively
  return num >= 0;
}

/** True if `node` is an arrow/function expression with a literal empty block body (`() => {}`), i.e. a no-op handler. */
function isEmptyFunctionHandler(node: import("typescript").Expression): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  return ts.isBlock(node.body) && node.body.statements.length === 0;
}

/** True if `text` references both the Enter key and the Space key, the two standard activation keys for a button-like control. */
function referencesActivationKeys(text: string): boolean {
  const hasEnter = /Enter/.test(text);
  const hasSpace = /Space/.test(text) || /["']\s["']/.test(text);
  return hasEnter && hasSpace;
}

/**
 * Flags a clickable `<div>`/`<span>` whose keyboard support is incomplete or
 * fake: missing/inert role, a keyboard-unreachable tabIndex, no key handler
 * at all, or a key handler that can't be shown to actually activate the
 * element (an empty no-op, or one that neither delegates to the same
 * callback as `onClick` nor visibly checks for Enter/Space). A handler that
 * is literally the same expression as `onClick` is accepted (a common,
 * valid "activate on any key" delegation pattern); one that performs its
 * own Enter/Space check is also accepted. The strongly preferred fix
 * remains converting the element to a real `<button>` (or other native
 * control), at which point this predicate no longer applies at all.
 */
function isStaticElementWithIncompleteKeyboardSemantics(el: JsxElementInfo): boolean {
  if (!NON_INTERACTIVE_CLICKABLE_TAGS.has(el.tagName)) return false;
  const onClick = el.attrs.get("onClick");
  if (!onClick) return false;

  if (!hasAppropriateInteractiveRole(el.attrs)) return true;
  if (!isKeyboardReachableTabIndex(el.attrs)) return true;

  const keyHandlerName = KEY_HANDLER_ATTR_NAMES.find((name) => el.attrs.has(name));
  if (!keyHandlerName) return true;
  const keyHandler = el.attrs.get(keyHandlerName);
  if (!keyHandler || keyHandler.kind === "boolean") return true;
  if (keyHandler.kind === "expression" && isEmptyFunctionHandler(keyHandler.node)) return true;

  if (onClick.kind === "expression" && keyHandler.kind === "expression" && onClick.text === keyHandler.text) {
    return false; // delegates to the exact same activation callback as onClick
  }
  if (keyHandler.kind === "expression" && referencesActivationKeys(keyHandler.text)) return false;
  if (keyHandler.kind === "string") return false; // non-empty string handler reference - conservatively accept

  return true; // present but its activation behavior can't be verified
}

// --------------------------- helper-correctness unit tests ---------------------------

describe("accessibility predicate helper correctness (fixtures, not the real source tree)", () => {
  function elementsOf(jsx: string): JsxElementInfo[] {
    const wrapped = `function __Fixture__() { return (${jsx}); }`;
    return collectJsxElements(parseSource("fixture.tsx", wrapped));
  }

  describe("isMissingExplicitButtonType", () => {
    test("flags a bare <button onClick=...> with no type", () => {
      const [el] = elementsOf(`<button onClick={() => {}}>Go</button>`);
      expect(isMissingExplicitButtonType(el)).toBe(true);
    });

    test("does not flag <button type=\"button\">", () => {
      const [el] = elementsOf(`<button type="button">Go</button>`);
      expect(isMissingExplicitButtonType(el)).toBe(false);
    });

    test("does not flag <button type=\"submit\"> or <button type=\"reset\">", () => {
      const [submitBtn] = elementsOf(`<button type="submit">Go</button>`);
      expect(isMissingExplicitButtonType(submitBtn)).toBe(false);
      const [resetBtn] = elementsOf(`<button type="reset">Go</button>`);
      expect(isMissingExplicitButtonType(resetBtn)).toBe(false);
    });

    test("REVIEW COUNTEREXAMPLE: flags <button type=\"\"> - present but not a valid button type", () => {
      const [el] = elementsOf(`<button type="">Go</button>`);
      expect(isMissingExplicitButtonType(el)).toBe(true);
    });

    test("flags <button type=\"buton\"> - a literal typo is not one of the three standard values", () => {
      const [el] = elementsOf(`<button type="buton">Go</button>`);
      expect(isMissingExplicitButtonType(el)).toBe(true);
    });

    test("does not flag a dynamic (non-literal) type - can't be statically verified, accepted conservatively", () => {
      const [el] = elementsOf(`<button type={computedType}>Go</button>`);
      expect(isMissingExplicitButtonType(el)).toBe(false);
    });

    test("does not flag a custom <Button> component (only literal 'button' tags are in scope)", () => {
      const [el] = elementsOf(`<Button onClick={() => {}}>Go</Button>`);
      expect(isMissingExplicitButtonType(el)).toBe(false);
    });
  });

  describe("isSvgWithoutAccessibleNameOrHiddenState", () => {
    test("flags a bare <svg> with neither aria-hidden nor an accessible name", () => {
      const [el] = elementsOf(`<svg><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(true);
    });

    test("does not flag aria-hidden='true' (decorative)", () => {
      const [el] = elementsOf(`<svg aria-hidden="true"><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(false);
    });

    test("does not flag a non-empty aria-label (informative)", () => {
      const [el] = elementsOf(`<svg aria-label="Close"><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(false);
    });

    test("still flags an empty-string aria-label (not a real accessible name)", () => {
      const [el] = elementsOf(`<svg aria-label=""><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(true);
    });

    test("does not flag aria-labelledby referencing a real, nonempty-text descendant", () => {
      const [el] = elementsOf(`<svg aria-labelledby="t1"><title id="t1">Close</title></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(false);
    });

    test("REVIEW COUNTEREXAMPLE: flags a nonempty aria-labelledby whose id does not resolve to any descendant (broken reference)", () => {
      const [el] = elementsOf(`<svg aria-labelledby="does-not-exist"><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(true);
    });

    test("flags aria-labelledby resolving to a descendant with matching id but empty text content", () => {
      const [el] = elementsOf(`<svg aria-labelledby="t1"><title id="t1"></title></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(true);
    });

    test("does not flag a dynamic (non-literal) aria-labelledby - can't be statically verified, accepted conservatively", () => {
      const [el] = elementsOf(`<svg aria-labelledby={dynamicId}><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(false);
    });

    test("REVIEW COUNTEREXAMPLE (round 3): does not flag a direct nonempty <title> child with no aria-* attribute at all (the native SVG accessible-name mechanism)", () => {
      const [el] = elementsOf(`<svg><title>GraphQL</title><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(false);
    });

    test("still flags a direct <title> child with empty text content", () => {
      const [el] = elementsOf(`<svg><title></title><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(true);
    });

    test("still flags an svg with no <title> at all and no aria-* attribute", () => {
      const [el] = elementsOf(`<svg><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(true);
    });

    test("REVIEW COUNTEREXAMPLE (round 3): resolves a whitespace-separated aria-labelledby token list, not the whole string as one id", () => {
      const [el] = elementsOf(
        `<svg aria-labelledby="title description"><title id="title">Close</title><desc id="description">Closes the dialog</desc></svg>`,
      );
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(false);
    });

    test("resolves a multi-token aria-labelledby when only the SECOND token resolves to nonempty text", () => {
      const [el] = elementsOf(
        `<svg aria-labelledby="missing-id title"><title id="title">Close</title></svg>`,
      );
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(false);
    });

    test("still flags a multi-token aria-labelledby when every token is broken/unresolved", () => {
      const [el] = elementsOf(`<svg aria-labelledby="missing-1 missing-2"><path d="M0 0" /></svg>`);
      expect(isSvgWithoutAccessibleNameOrHiddenState(el)).toBe(true);
    });
  });

  describe("isLabelWithoutValidAssociation", () => {
    test("flags a <label> wrapping a custom control with no htmlFor", () => {
      const [, label] = elementsOf(`<div><label><Checkbox id="x" />text</label></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(true);
    });

    test("does not flag a <label> whose htmlFor matches a declared id on a supported custom control (nested)", () => {
      const [, label] = elementsOf(`<div><label htmlFor="cb1"><Checkbox id="cb1" />text</label></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(false);
    });

    test("does not flag a <label> whose htmlFor matches a declared id on a SIBLING native control, not a descendant", () => {
      // Mirrors the real-world <label htmlFor="x"><input id="x"/></label>-less
      // pattern where the control lives elsewhere in the form, not nested
      // inside the label.
      const [, label] = elementsOf(`<div><label htmlFor="email">Email</label><input id="email" /></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(false);
    });

    test("REVIEW COUNTEREXAMPLE (round 1): flags a <label> whose htmlFor does NOT match any declared id (typo'd for/id pair)", () => {
      const [label] = elementsOf(`<label htmlFor="typo">Name</label><input id="actual" />`);
      expect(isLabelWithoutValidAssociation(label)).toBe(true);
    });

    test("REVIEW COUNTEREXAMPLE (round 2, #1): flags a <label> whose htmlFor matches an id on a NON-labelable element (a plain <div>)", () => {
      const [label] = elementsOf(`<><label htmlFor="panel">Name</label><div id="panel" /></>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(true);
    });

    test("REVIEW COUNTEREXAMPLE (round 2, #2): flags a <label> whose htmlFor matches an id that only exists in a DIFFERENT, unrelated component in the same file", () => {
      const source = `
        import React from "react";
        function Other() {
          return <input id="shared" />;
        }
        function __Fixture__() {
          return <label htmlFor="shared">Name</label>;
        }
      `;
      const sourceFile = parseSource("fixture.tsx", source);
      const [label] = collectJsxElements(sourceFile).filter((el) => el.tagName === "label");
      expect(isLabelWithoutValidAssociation(label)).toBe(true);
    });

    test("does not flag a <label> directly wrapping a native <input> (no htmlFor needed)", () => {
      const [, label] = elementsOf(`<div><label><input type="checkbox" />text</label></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(false);
    });

    test("REVIEW COUNTEREXAMPLE (round 3): does not flag a <label> whose htmlFor matches a sibling <output>'s id (the expanded native labelable set includes button/meter/output/progress, not just input/select/textarea)", () => {
      const [, label] = elementsOf(`<div><label htmlFor="total">Total</label><output id="total">42</output></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(false);
    });

    test("does not flag a <label> directly wrapping a native <meter> (no htmlFor needed)", () => {
      const [, label] = elementsOf(`<div><label><meter value={0.5} />text</label></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(false);
    });

    test("flags a <label> with an empty-string htmlFor and no native control child", () => {
      const [, label] = elementsOf(`<div><label htmlFor=""><Checkbox id="x" />text</label></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(true);
    });

    test("does not flag a dynamic (non-literal) htmlFor - can't be statically verified, accepted conservatively", () => {
      const [, label] = elementsOf(`<div><label htmlFor={dynamicId}><Checkbox id={dynamicId} />text</label></div>`);
      expect(isLabelWithoutValidAssociation(label)).toBe(false);
    });
  });

  describe("isStaticElementWithIncompleteKeyboardSemantics", () => {
    test("flags a <div onClick> with no role/tabIndex/key handler", () => {
      const [el] = elementsOf(`<div onClick={() => {}} />`);
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(true);
    });

    test("flags a <div onClick> with a key handler but missing tabIndex", () => {
      const [el] = elementsOf(
        `<div role="button" onClick={() => {}} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") doIt(); }} />`,
      );
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(true);
    });

    test("REVIEW COUNTEREXAMPLE (round 1): flags role='presentation' even with tabIndex and a real key handler (wrong/inert role)", () => {
      const [el] = elementsOf(
        `<div role="presentation" tabIndex={0} onClick={() => {}} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") doIt(); }} />`,
      );
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(true);
    });

    test("REVIEW COUNTEREXAMPLE (round 2): flags role='img' even with tabIndex and a real key handler - non-interactive roles are not an allowlisted interactive role, even though they aren't 'presentation'/'none'", () => {
      const [el] = elementsOf(
        `<div role="img" tabIndex={0} onClick={activate} onKeyDown={activate} />`,
      );
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(true);
    });

    test("REVIEW COUNTEREXAMPLE (round 2): flags role='heading' (another structural, non-interactive role) the same way", () => {
      const [el] = elementsOf(
        `<div role="heading" tabIndex={0} onClick={activate} onKeyDown={activate} />`,
      );
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(true);
    });

    test("does not flag an allowlisted interactive role other than 'button' (e.g. role='checkbox')", () => {
      const [el] = elementsOf(
        `<div role="checkbox" tabIndex={0} onClick={() => { doIt(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") doIt(); }} />`,
      );
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(false);
    });

    test("REVIEW COUNTEREXAMPLE: flags a negative tabIndex={-1} even with an appropriate role and a real key handler (not keyboard-reachable)", () => {
      const [el] = elementsOf(
        `<div role="button" tabIndex={-1} onClick={() => {}} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") doIt(); }} />`,
      );
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(true);
    });

    test("REVIEW COUNTEREXAMPLE: flags an inert empty-body onKeyDown={() => {}} even with an appropriate role and tabIndex", () => {
      const [el] = elementsOf(`<div role="button" tabIndex={0} onClick={() => { doIt(); }} onKeyDown={() => {}} />`);
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(true);
    });

    test("does not flag role + tabIndex + a key handler that checks for Enter and Space", () => {
      const [el] = elementsOf(
        `<div role="button" tabIndex={0} onClick={() => { doIt(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") doIt(); }} />`,
      );
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(false);
    });

    test("does not flag role + tabIndex + a key handler that delegates to the exact same callback as onClick", () => {
      const [el] = elementsOf(`<div role="button" tabIndex={0} onClick={onClose} onKeyDown={onClose} />`);
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(false);
    });

    test("does not flag a <div> with no onClick at all", () => {
      const [el] = elementsOf(`<div className="scrim" />`);
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(false);
    });

    test("does not apply to a real <button onClick> (already a native control)", () => {
      const [el] = elementsOf(`<button type="button" onClick={() => {}} />`);
      expect(isStaticElementWithIncompleteKeyboardSemantics(el)).toBe(false);
    });
  });
});

// --------------------------- real frontend/src scan ---------------------------

const SOURCE_FILES = discoverFilesRecursive(FRONTEND_SRC, /\.tsx?$/, new Set(["node_modules"]));

function scanRepo(predicate: (el: JsxElementInfo) => boolean): string[] {
  const violations: string[] = [];
  for (const filePath of SOURCE_FILES) {
    const text = readFileSync(filePath, "utf8");
    const sourceFile = parseSource(filePath, text);
    for (const el of collectJsxElements(sourceFile)) {
      if (predicate(el)) {
        violations.push(`${filePath.replace(REPO_ROOT, "").replaceAll("\\", "/")}:${el.line} <${el.tagName}>`);
      }
    }
  }
  return violations;
}

describe("every frontend/src <button> has an explicit type (requirement 4)", () => {
  test("no discovered <button> element is missing a 'type' attribute", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
    const violations = scanRepo(isMissingExplicitButtonType);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("every frontend/src inline <svg> has an accessible name or is correctly hidden (requirement 4)", () => {
  test("no discovered <svg> is missing both aria-hidden and an accessible name", () => {
    const violations = scanRepo(isSvgWithoutAccessibleNameOrHiddenState);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("every frontend/src <label> retains a valid accessible association (requirement 4)", () => {
  test("no discovered <label> lacks both a same-component matching-id htmlFor (on a labelable target) and a wrapped labelable control", () => {
    const violations = scanRepo(isLabelWithoutValidAssociation);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("every clickable frontend/src <div>/<span> has complete keyboard semantics (requirement 4)", () => {
  test("no discovered onClick-bearing <div>/<span> lacks role + tabIndex + a key handler", () => {
    const violations = scanRepo(isStaticElementWithIncompleteKeyboardSemantics);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("raw SVG asset files declare a non-empty <title> (requirement 4, non-JSX assets)", () => {
  const assetsDir = join(FRONTEND_SRC, "assets");
  const svgAssets = discoverFilesRecursive(assetsDir, /\.svg$/, new Set());

  test("at least one raw .svg asset is discovered", () => {
    expect(svgAssets.length).toBeGreaterThan(0);
  });

  for (const assetPath of svgAssets) {
    const relPath = assetPath.replace(REPO_ROOT, "").replaceAll("\\", "/");
    test(`'${relPath}' contains a non-empty <title>...</title>`, () => {
      const source = readFileSync(assetPath, "utf8");
      const match = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      expect(match, source.slice(0, 200)).not.toBeNull();
      expect((match?.[1] ?? "").trim().length).toBeGreaterThan(0);
    });
  }
});
