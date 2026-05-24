# Parameterized Feed Config Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a template syntax to catalog/imported YAML configs so users fill in values at import time before a normal FeedConfig is saved; workers always process resolved configs.

**Architecture:** New `models/feed-template.model.ts` and `utilities/feed-template.utility.ts` handle all parsing, validation, and rendering. Catalog import route calls the renderer before normalization. A `POST /community-catalog/preview-template/:id` endpoint returns masked previews. Frontend adds a `TemplateImportDialog` that renders a dynamic form from `template.variables`.

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this plan.**

**Tech Stack:** Bun, TypeScript, Hono, React 18, shadcn/ui, `bun:test`

**Depends on (must be implemented first):**
- Protected Value Encryption
- Feed Config Formalization
- Community Catalog

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/feed-template.model.ts` | All template/variable/rendering types |
| Modify | `models/protected-value.model.ts` | Add `prefix?`/`suffix?` to env variant |
| Create | `utilities/feed-template.utility.ts` | Parser, validator, renderer, filter engine |
| Create | `tests/feed-template.test.ts` | All unit tests |
| Modify | `routes/catalog.ts` | Update import endpoint, add preview-template endpoint |
| Modify | `routes/configs.ts` | Detect template during manual import |
| Modify | `scripts/validate-community-catalog.ts` | Template-aware CI validation |
| Create | `frontend/src/components/catalog/TemplateImportDialog.tsx` | Dynamic import form |
| Create | `frontend/src/components/catalog/TemplateVariableField.tsx` | Single variable input |
| Create | `frontend/src/components/catalog/SecretTemplateVariableField.tsx` | Secret + storage mode |
| Modify | `frontend/src/components/catalog/CatalogImportDialog.tsx` | Route to template dialog when template exists |

---

### Task 1: Template model and ProtectedValue extension

**Files:**
- Create: `models/feed-template.model.ts`
- Modify: `models/protected-value.model.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/feed-template.test.ts
import { describe, expect, test } from "bun:test";
import type { FeedConfigTemplate, FeedConfigTemplateVariable } from "../models/feed-template.model";
import type { ProtectedValue } from "../models/protected-value.model";

describe("feed-template model types", () => {
  test("FeedConfigTemplate compiles with all variable types", () => {
    const template: FeedConfigTemplate = {
      variables: {
        owner: { label: "Owner", type: "string", required: true },
        count: { label: "Count", type: "number", defaultValue: 20 },
        enabled: { label: "Enabled", type: "boolean" },
        endpoint: { label: "Endpoint", type: "url" },
        mode: { label: "Mode", type: "select", options: [{ label: "A", value: "a" }] },
        body: { label: "Body", type: "textarea" },
        apiKey: { label: "API Key", type: "secret", encrypted: true },
      },
    };
    expect(Object.keys(template.variables)).toHaveLength(7);
  });

  test("ProtectedValue env variant accepts prefix and suffix", () => {
    const v: ProtectedValue = {
      type: "env",
      value: "GITHUB_TOKEN",
      prefix: "Bearer ",
    };
    expect(v.prefix).toBe("Bearer ");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
bun test tests/feed-template.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `models/feed-template.model.ts`**

```ts
export type FeedConfigTemplate = {
  variables: Record<string, FeedConfigTemplateVariable>;
};

export type FeedConfigTemplateVariable = {
  label: string;
  description?: string;
  type: "string" | "number" | "boolean" | "url" | "select" | "textarea" | "secret";
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  encrypted?: boolean;
  validation?: FeedConfigTemplateVariableValidation;
  options?: Array<{ label: string; value: string }>;
};

export type FeedConfigTemplateVariableValidation = {
  pattern?: string;
  min?: number;
  max?: number;
  allowedHosts?: string[];
  disallowedHosts?: string[];
};

export type FeedConfigTemplateValues = Record<string, unknown>;

export type FeedConfigTemplateSecretStorage = Record<string, "protected" | "env" | "plain">;

export type RenderFeedConfigTemplateOptions = {
  feedId: string;
  encryptionKey: string;
  values: FeedConfigTemplateValues;
  secretStorage?: FeedConfigTemplateSecretStorage;
  origin?: { type: "community" | "manual"; catalogId?: string };
};

export type TemplateExpression = {
  path: string;
  raw: string;
  namespace: "value" | "secret";
  variableName: string;
  filters: string[];
};

export type FeedTemplateValidationResult = {
  valid: boolean;
  errors: FeedTemplateValidationIssue[];
  warnings: FeedTemplateValidationIssue[];
};

export type FeedTemplateValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};
```

- [ ] **Step 4: Modify `models/protected-value.model.ts`** — add `prefix?`/`suffix?` to env variant:

```ts
export type ProtectedValue =
  | { type: "protected"; value: string }
  | { type: "env"; value: string; prefix?: string; suffix?: string };
```

Also update `resolveProtectedValue` in `utilities/protected-value.utility.ts`:

```ts
if (value.type === "env") {
  const raw = process.env[value.value];
  if (!raw) throw new Error(`Missing environment variable: ${value.value}`);
  return `${value.prefix ?? ""}${raw}${value.suffix ?? ""}`;
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
bun test tests/feed-template.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add models/feed-template.model.ts models/protected-value.model.ts
git commit -m "feat: add feed template model and extend ProtectedValue env with prefix/suffix"
```

---

### Task 2: Template expression parser

**Files:**
- Modify: `utilities/feed-template.utility.ts` (create if not exists)
- Modify: `tests/feed-template.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { parseTemplateExpression, findTemplateExpressions } from "../utilities/feed-template.utility";

describe("parseTemplateExpression", () => {
  test("parses simple variable", () => {
    const expr = parseTemplateExpression("{{ owner }}");
    expect(expr).toEqual({
      raw: "{{ owner }}",
      namespace: "value",
      variableName: "owner",
      filters: [],
    });
  });

  test("parses variable with filter", () => {
    const expr = parseTemplateExpression("{{ owner | slug }}");
    expect(expr?.filters).toEqual(["slug"]);
  });

  test("parses secret variable", () => {
    const expr = parseTemplateExpression("{{ secret.token }}");
    expect(expr?.namespace).toBe("secret");
    expect(expr?.variableName).toBe("token");
  });

  test("parses secret with bearer filter", () => {
    const expr = parseTemplateExpression("{{ secret.token | bearer }}");
    expect(expr?.namespace).toBe("secret");
    expect(expr?.filters).toEqual(["bearer"]);
  });

  test("returns null for non-expression string", () => {
    expect(parseTemplateExpression("hello world")).toBeNull();
  });

  test("findTemplateExpressions walks nested object", () => {
    const input = {
      config: { route: "/repos/{{ owner }}/{{ repo }}/releases" },
      headers: { Authorization: "{{ secret.token | bearer }}" },
    };
    const exprs = findTemplateExpressions(input);
    expect(exprs.map((e) => e.variableName)).toContain("owner");
    expect(exprs.map((e) => e.variableName)).toContain("repo");
    expect(exprs.map((e) => e.variableName)).toContain("token");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/feed-template.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement parser in `utilities/feed-template.utility.ts`**

```ts
import type {
  FeedConfigTemplate,
  FeedConfigTemplateValues,
  FeedConfigTemplateSecretStorage,
  FeedTemplateValidationResult,
  FeedTemplateValidationIssue,
  RenderFeedConfigTemplateOptions,
  TemplateExpression,
} from "../models/feed-template.model";

const TEMPLATE_EXPR_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;
const ALLOWED_FILTERS = ["trim", "lower", "upper", "slug", "urlEncode", "bearer"];

export function parseTemplateExpression(raw: string): Omit<TemplateExpression, "path"> | null {
  const match = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(raw.trim());
  if (!match) return null;

  const inner = match[1].trim();
  const parts = inner.split("|").map((p) => p.trim());
  const namePart = parts[0];
  const filters = parts.slice(1);

  const isSecret = namePart.startsWith("secret.");
  const variableName = isSecret ? namePart.slice("secret.".length) : namePart;

  return {
    raw,
    namespace: isSecret ? "secret" : "value",
    variableName,
    filters,
  };
}

export function findTemplateExpressions(input: unknown, path = ""): TemplateExpression[] {
  const results: TemplateExpression[] = [];

  if (typeof input === "string") {
    let match: RegExpExecArray | null;
    const re = new RegExp(TEMPLATE_EXPR_REGEX.source, "g");
    while ((match = re.exec(input)) !== null) {
      const parsed = parseTemplateExpression(match[0]);
      if (parsed) results.push({ ...parsed, path });
    }
  } else if (Array.isArray(input)) {
    input.forEach((item, i) =>
      results.push(...findTemplateExpressions(item, `${path}[${i}]`))
    );
  } else if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      results.push(...findTemplateExpressions(value, path ? `${path}.${key}` : key));
    }
  }

  return results;
}

export function hasFeedTemplate(input: unknown): boolean {
  return (
    input !== null &&
    typeof input === "object" &&
    "template" in (input as Record<string, unknown>) &&
    typeof (input as Record<string, unknown>).template === "object"
  );
}

export function extractFeedTemplate(input: unknown): FeedConfigTemplate | undefined {
  if (!hasFeedTemplate(input)) return undefined;
  const t = (input as Record<string, unknown>).template;
  if (t && typeof t === "object" && "variables" in (t as object)) {
    return t as FeedConfigTemplate;
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
bun test tests/feed-template.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-template.utility.ts tests/feed-template.test.ts
git commit -m "feat: add template expression parser and findTemplateExpressions"
```

---

### Task 3: Template and value validation

**Files:**
- Modify: `utilities/feed-template.utility.ts`
- Modify: `tests/feed-template.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { validateFeedTemplate, validateTemplateValues } from "../utilities/feed-template.utility";

describe("validateFeedTemplate", () => {
  test("valid template passes", () => {
    const input = {
      template: {
        variables: {
          owner: { label: "Owner", type: "string", required: true },
          token: { label: "Token", type: "secret" },
        },
      },
      config: { route: "/repos/{{ owner }}/releases" },
    };
    const result = validateFeedTemplate(input);
    expect(result.valid).toBe(true);
  });

  test("rejects undeclared placeholder", () => {
    const input = {
      template: { variables: { owner: { label: "Owner", type: "string" } } },
      config: { route: "/repos/{{ owner }}/{{ undeclared }}/releases" },
    };
    const result = validateFeedTemplate(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("undeclared"))).toBe(true);
  });

  test("rejects secret.* for non-secret variable", () => {
    const input = {
      template: { variables: { token: { label: "Token", type: "string" } } },
      headers: { Authorization: "{{ secret.token | bearer }}" },
    };
    const result = validateFeedTemplate(input);
    expect(result.valid).toBe(false);
  });

  test("rejects normal placeholder for secret variable", () => {
    const input = {
      template: { variables: { token: { label: "Token", type: "secret" } } },
      config: { route: "/token/{{ token }}" },
    };
    const result = validateFeedTemplate(input);
    expect(result.valid).toBe(false);
  });

  test("rejects select variable without options", () => {
    const input = {
      template: { variables: { mode: { label: "Mode", type: "select" } } },
    };
    const result = validateFeedTemplate(input);
    expect(result.valid).toBe(false);
  });
});

describe("validateTemplateValues", () => {
  const template: FeedConfigTemplate = {
    variables: {
      owner: { label: "Owner", type: "string", required: true },
      count: { label: "Count", type: "number" },
      endpoint: { label: "Endpoint", type: "url" },
      mode: { label: "Mode", type: "select", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
    },
  };

  test("valid values pass", () => {
    const result = validateTemplateValues(template, { owner: "TBosak", count: 20, mode: "a" });
    expect(result.valid).toBe(true);
  });

  test("rejects missing required value", () => {
    const result = validateTemplateValues(template, {});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "owner")).toBe(true);
  });

  test("rejects invalid URL", () => {
    const t: FeedConfigTemplate = { variables: { ep: { label: "EP", type: "url", required: true } } };
    const result = validateTemplateValues(t, { ep: "not-a-url" });
    expect(result.valid).toBe(false);
  });

  test("rejects select value not in options", () => {
    const result = validateTemplateValues(template, { owner: "x", mode: "invalid" });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/feed-template.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement validation functions**

```ts
export function validateFeedTemplate(input: unknown): FeedTemplateValidationResult {
  const errors: FeedTemplateValidationIssue[] = [];
  const warnings: FeedTemplateValidationIssue[] = [];
  const template = extractFeedTemplate(input);

  if (!template) {
    return { valid: true, errors: [], warnings: [] };
  }

  // Validate variable declarations
  for (const [name, variable] of Object.entries(template.variables)) {
    if (!variable.label) {
      errors.push({ path: `template.variables.${name}`, message: "Variable must have a label.", severity: "error" });
    }
    if (variable.type === "select" && (!variable.options || variable.options.length === 0)) {
      errors.push({ path: `template.variables.${name}`, message: "Select variable must have options.", severity: "error" });
    }
    if (variable.validation?.pattern) {
      try { new RegExp(variable.validation.pattern); }
      catch {
        errors.push({ path: `template.variables.${name}.validation.pattern`, message: "Invalid regex pattern.", severity: "error" });
      }
    }
  }

  // Validate placeholder usage
  const expressions = findTemplateExpressions(input);
  for (const expr of expressions) {
    // Skip expressions inside template block itself
    if (expr.path.startsWith("template")) continue;

    const variable = template.variables[expr.variableName];

    if (!variable) {
      errors.push({ path: expr.path, message: `Undeclared template variable: ${expr.variableName}`, severity: "error" });
      continue;
    }

    if (expr.namespace === "secret" && variable.type !== "secret") {
      errors.push({ path: expr.path, message: `secret.${expr.variableName} used but variable type is not "secret".`, severity: "error" });
    }

    if (expr.namespace === "value" && variable.type === "secret") {
      errors.push({ path: expr.path, message: `Secret variable ${expr.variableName} must be referenced as secret.${expr.variableName}.`, severity: "error" });
    }

    for (const filter of expr.filters) {
      if (!ALLOWED_FILTERS.includes(filter)) {
        errors.push({ path: expr.path, message: `Unsupported template filter: ${filter}`, severity: "error" });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateTemplateValues(
  template: FeedConfigTemplate,
  values: Record<string, unknown>,
  _secretStorage?: FeedConfigTemplateSecretStorage,
): FeedTemplateValidationResult {
  const errors: FeedTemplateValidationIssue[] = [];
  const warnings: FeedTemplateValidationIssue[] = [];

  for (const [name, variable] of Object.entries(template.variables)) {
    const value = values[name];
    const isEmpty = value === undefined || value === null || value === "";

    if (variable.required && isEmpty) {
      errors.push({ path: name, message: `${variable.label} is required.`, severity: "error" });
      continue;
    }
    if (isEmpty) continue;

    if (variable.type === "number" && typeof value !== "number" && isNaN(Number(value))) {
      errors.push({ path: name, message: `${variable.label} must be a number.`, severity: "error" });
    }

    if (variable.type === "url") {
      try { new URL(String(value)); }
      catch { errors.push({ path: name, message: `${variable.label} must be a valid URL.`, severity: "error" }); }
    }

    if (variable.type === "select" && variable.options) {
      const allowed = variable.options.map((o) => o.value);
      if (!allowed.includes(String(value))) {
        errors.push({ path: name, message: `${variable.label} must be one of: ${allowed.join(", ")}.`, severity: "error" });
      }
    }

    if (variable.validation?.pattern) {
      try {
        if (!new RegExp(variable.validation.pattern).test(String(value))) {
          errors.push({ path: name, message: `${variable.label} does not match the required pattern.`, severity: "error" });
        }
      } catch { /* skip invalid regex - caught in template validation */ }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/feed-template.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-template.utility.ts tests/feed-template.test.ts
git commit -m "feat: add template and value validation"
```

---

### Task 4: Filter engine and template renderer

**Files:**
- Modify: `utilities/feed-template.utility.ts`
- Modify: `tests/feed-template.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import {
  applyTemplateFilters,
  renderFeedConfigTemplate,
  findUnresolvedTemplateExpressions,
} from "../utilities/feed-template.utility";

describe("applyTemplateFilters", () => {
  test("trim", () => expect(applyTemplateFilters("  hello  ", ["trim"])).toBe("hello"));
  test("lower", () => expect(applyTemplateFilters("HELLO", ["lower"])).toBe("hello"));
  test("upper", () => expect(applyTemplateFilters("hello", ["upper"])).toBe("HELLO"));
  test("slug", () => expect(applyTemplateFilters("Hello World!", ["slug"])).toBe("hello-world"));
  test("urlEncode", () => expect(applyTemplateFilters("hello world", ["urlEncode"])).toBe("hello%20world"));
  test("bearer", () => expect(applyTemplateFilters("mytoken", ["bearer"])).toBe("Bearer mytoken"));
  test("chained filters", () => expect(applyTemplateFilters("  Hello World  ", ["trim", "lower", "slug"])).toBe("hello-world"));
  test("rejects unknown filter", () => {
    expect(() => applyTemplateFilters("x", ["unknown"])).toThrow("Unsupported template filter");
  });
});

describe("renderFeedConfigTemplate", () => {
  const FAKE_ENCRYPTION_KEY = "test-key-32-chars-exactly-here!!";

  test("renders simple value placeholder", () => {
    const input = {
      template: { variables: { owner: { label: "Owner", type: "string", required: true } } },
      config: { route: "/repos/{{ owner }}/releases" },
    };
    const result = renderFeedConfigTemplate(input, {
      feedId: "test-id",
      encryptionKey: FAKE_ENCRYPTION_KEY,
      values: { owner: "TBosak" },
    });
    expect((result.config as Record<string, unknown>).route).toBe("/repos/TBosak/releases");
    expect(result.template).toBeUndefined();
    expect(result.feedId).toBe("test-id");
    expect(result.schemaVersion).toBe(2);
  });

  test("removes empty optional secret field", () => {
    const input = {
      template: { variables: { token: { label: "Token", type: "secret" } } },
      headers: { Accept: "application/json", Authorization: "{{ secret.token | bearer }}" },
    };
    const result = renderFeedConfigTemplate(input, {
      feedId: "test-id",
      encryptionKey: FAKE_ENCRYPTION_KEY,
      values: {},
    });
    expect((result.headers as Record<string, unknown>).Authorization).toBeUndefined();
    expect((result.headers as Record<string, unknown>).Accept).toBe("application/json");
  });

  test("hard-fails when unresolved expressions remain", () => {
    const input = {
      template: { variables: { owner: { label: "Owner", type: "string", required: true } } },
      config: { route: "/repos/{{ owner }}/releases" },
    };
    expect(() =>
      renderFeedConfigTemplate(input, {
        feedId: "test-id",
        encryptionKey: FAKE_ENCRYPTION_KEY,
        values: {}, // missing required owner
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/feed-template.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement filter engine and renderer**

```ts
export function applyTemplateFilters(value: string, filters: string[]): string {
  return filters.reduce((current, filter) => {
    switch (filter) {
      case "trim": return current.trim();
      case "lower": return current.toLowerCase();
      case "upper": return current.toUpperCase();
      case "slug": return current.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      case "urlEncode": return encodeURIComponent(current);
      case "bearer": return `Bearer ${current}`;
      default: throw new Error(`Unsupported template filter: ${filter}`);
    }
  }, value);
}

export function findUnresolvedTemplateExpressions(input: unknown): TemplateExpression[] {
  return findTemplateExpressions(input);
}

export function renderFeedConfigTemplate(
  input: Record<string, unknown>,
  options: RenderFeedConfigTemplateOptions,
): Record<string, unknown> {
  const template = extractFeedTemplate(input);
  if (!template) {
    return { ...input, feedId: options.feedId, schemaVersion: 2 };
  }

  const schemaValidation = validateFeedTemplate(input);
  if (!schemaValidation.valid) throw new Error(`Invalid feed template: ${schemaValidation.errors.map((e) => e.message).join("; ")}`);

  const valuesValidation = validateTemplateValues(template, options.values, options.secretStorage);
  if (!valuesValidation.valid) throw new Error(`Invalid template values: ${valuesValidation.errors.map((e) => e.message).join("; ")}`);

  const cloned = structuredClone(input);
  delete (cloned as Record<string, unknown>).template;
  delete (cloned as Record<string, unknown>).catalogVersion;

  const rendered = renderValue(cloned, template, options);

  (rendered as Record<string, unknown>).feedId = options.feedId;
  (rendered as Record<string, unknown>).schemaVersion = 2;
  (rendered as Record<string, unknown>).metadata = {
    ...((rendered as Record<string, unknown>).metadata ?? {}),
    origin: options.origin,
  };

  const unresolved = findUnresolvedTemplateExpressions(rendered);
  if (unresolved.length > 0) {
    throw new Error(
      `Rendered config still contains unresolved template expressions: ${unresolved.map((e) => e.raw).join(", ")}`
    );
  }

  return rendered as Record<string, unknown>;
}

function renderValue(
  value: unknown,
  template: FeedConfigTemplate,
  options: RenderFeedConfigTemplateOptions,
): unknown {
  if (typeof value === "string") {
    return renderString(value, template, options);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, template, options));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const rendered = renderValue(v, template, options);
      if (rendered !== undefined) result[k] = rendered;
    }
    return result;
  }
  return value;
}

function renderString(
  str: string,
  template: FeedConfigTemplate,
  options: RenderFeedConfigTemplateOptions,
): unknown {
  // If the entire string is a single expression that is a secret, return ProtectedValue object
  const singleExprMatch = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(str.trim());
  if (singleExprMatch) {
    const parsed = parseTemplateExpression(str.trim());
    if (parsed?.namespace === "secret") {
      return renderSecretExpression(parsed, template, options);
    }
  }

  // Otherwise do string interpolation
  const result = str.replace(TEMPLATE_EXPR_REGEX, (match) => {
    const parsed = parseTemplateExpression(match);
    if (!parsed) return match;
    if (parsed.namespace === "secret") return ""; // handled separately
    const rawValue = options.values[parsed.variableName];
    if (rawValue === undefined || rawValue === null || rawValue === "") return "";
    return applyTemplateFilters(String(rawValue), parsed.filters);
  });

  return result;
}

function renderSecretExpression(
  expr: Omit<TemplateExpression, "path">,
  template: FeedConfigTemplate,
  options: RenderFeedConfigTemplateOptions,
): unknown {
  const variable = template.variables[expr.variableName];
  const rawValue = options.values[expr.variableName];
  const storage = options.secretStorage?.[expr.variableName] ?? "protected";

  // Empty optional secret → remove field
  if (!variable?.required && (rawValue === undefined || rawValue === null || rawValue === "")) {
    return undefined;
  }

  const hasBearerFilter = expr.filters.includes("bearer");

  if (storage === "env") {
    return {
      type: "env",
      value: String(rawValue),
      ...(hasBearerFilter ? { prefix: "Bearer " } : {}),
    };
  }

  if (storage === "plain") {
    const plaintextValue = hasBearerFilter
      ? `Bearer ${String(rawValue)}`
      : String(rawValue);
    return plaintextValue;
  }

  // protected mode: encrypt
  const { encrypt } = require("./security.utility");
  const plaintextToEncrypt = hasBearerFilter
    ? `Bearer ${String(rawValue)}`
    : String(rawValue);

  return {
    type: "protected",
    value: encrypt(plaintextToEncrypt, options.encryptionKey),
  };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/feed-template.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-template.utility.ts tests/feed-template.test.ts
git commit -m "feat: add template filter engine and renderer"
```

---

### Task 5: Backend catalog import and preview-template endpoints

**Files:**
- Modify: `routes/catalog.ts`

- [ ] **Step 1: Write failing tests**

```ts
// In an existing catalog route test file or new file
import { describe, expect, test } from "bun:test";
import app from "../index";

describe("POST /community-catalog/import/:id with template", () => {
  test("renders template before saving", async () => {
    // Mock getCatalogFeedYaml to return a template config
    const response = await app.request("/community-catalog/import/github-releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        values: { owner: "TBosak", repo: "mkfd" },
        secretStorage: {},
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.feedId).toBeDefined();
  });

  test("rejects missing required template value", async () => {
    const response = await app.request("/community-catalog/import/github-releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: {} }),
    });
    expect(response.status).toBe(400);
  });
});

describe("POST /community-catalog/preview-template/:id", () => {
  test("returns masked rendered YAML", async () => {
    const response = await app.request("/community-catalog/preview-template/github-releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        values: { owner: "TBosak", repo: "mkfd", token: "ghp_secret" },
        secretStorage: { token: "protected" },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.valid).toBe(true);
    expect(body.renderedYaml).toContain("TBosak");
    expect(body.renderedYaml).not.toContain("ghp_secret");
    expect(body.renderedYaml).toContain("********");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/catalog.test.ts
```

Expected: FAIL

- [ ] **Step 3: Update `routes/catalog.ts` import endpoint**

In the import endpoint handler, after fetching catalog YAML:

```ts
import { hasFeedTemplate, renderFeedConfigTemplate, validateFeedTemplate, validateTemplateValues } from "../utilities/feed-template.utility";

// POST /community-catalog/import/:id
const parsed = yaml.load(catalogYaml.yaml) as Record<string, unknown>;
const feedId = crypto.randomUUID();

let rendered: Record<string, unknown>;

if (hasFeedTemplate(parsed)) {
  const templateValidation = validateFeedTemplate(parsed);
  if (!templateValidation.valid) return c.json({ ok: false, errors: templateValidation.errors }, 400);

  const body = await c.req.json() as { values?: Record<string, unknown>; secretStorage?: Record<string, "protected" | "env">; feedName?: string };

  const valuesValidation = validateTemplateValues(
    extractFeedTemplate(parsed)!,
    body.values ?? {},
    body.secretStorage,
  );
  if (!valuesValidation.valid) return c.json({ ok: false, errors: valuesValidation.errors }, 400);

  rendered = renderFeedConfigTemplate(parsed, {
    feedId,
    encryptionKey: process.env.ENCRYPTION_KEY ?? "",
    values: body.values ?? {},
    secretStorage: body.secretStorage ?? {},
    origin: { type: "community", catalogId: id },
  });

  if (body.feedName) rendered.feedName = body.feedName;
} else {
  rendered = { ...parsed, feedId, schemaVersion: 2 };
}
```

- [ ] **Step 4: Add `POST /community-catalog/preview-template/:id`**

```ts
router.post("/community-catalog/preview-template/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json() as { values: Record<string, unknown>; secretStorage?: Record<string, "protected" | "env"> };
  const catalogYaml = await getCatalogFeedYaml(id);
  const parsed = yaml.load(catalogYaml.yaml) as Record<string, unknown>;

  const templateValidation = validateFeedTemplate(parsed);
  if (!templateValidation.valid) {
    return c.json({ valid: false, errors: templateValidation.errors, warnings: [] });
  }

  try {
    const rendered = renderFeedConfigTemplate(parsed, {
      feedId: "preview",
      encryptionKey: process.env.ENCRYPTION_KEY ?? "",
      values: body.values ?? {},
      secretStorage: body.secretStorage ?? {},
      origin: { type: "community", catalogId: id },
    });

    // Mask protected values
    const maskedRendered = maskProtectedValuesForPreview(rendered);
    const renderedYaml = yaml.dump(maskedRendered);

    return c.json({ valid: true, renderedYaml, errors: [], warnings: [] });
  } catch (err) {
    return c.json({ valid: false, renderedYaml: undefined, errors: [{ path: "", message: String(err), severity: "error" }], warnings: [] });
  }
});

function maskProtectedValuesForPreview(obj: unknown): unknown {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    if (record.type === "protected" && record.value) {
      return { ...record, value: "********" };
    }
    return Object.fromEntries(
      Object.entries(record).map(([k, v]) => [k, maskProtectedValuesForPreview(v)])
    );
  }
  if (Array.isArray(obj)) return obj.map(maskProtectedValuesForPreview);
  return obj;
}
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/catalog.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add routes/catalog.ts tests/catalog.test.ts
git commit -m "feat: add template rendering to catalog import, add preview-template endpoint"
```

---

### Task 6: Manual import template detection

**Files:**
- Modify: `routes/configs.ts`

- [ ] **Step 1: Write failing test**

```ts
describe("POST /configs/import with template", () => {
  test("detects template in pasted YAML and renders it", async () => {
    const templateYaml = yaml.dump({
      template: { variables: { owner: { label: "Owner", type: "string", required: true } } },
      feedType: "rest",
      config: { route: "/repos/{{ owner }}/releases" },
    });
    const response = await app.request("/configs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yaml: templateYaml,
        values: { owner: "TBosak" },
        secretStorage: {},
      }),
    });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.feedId).toBeDefined();
  });

  test("returns templateInfo when no values provided for template YAML", async () => {
    const templateYaml = yaml.dump({
      template: { variables: { owner: { label: "Owner", type: "string", required: true } } },
      feedType: "rest",
    });
    const response = await app.request("/configs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: templateYaml }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requiresTemplateValues).toBe(true);
    expect(body.template).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/configs.test.ts
```

Expected: FAIL

- [ ] **Step 3: Add template detection logic to `routes/configs.ts`**

In the import handler:

```ts
const parsed = yaml.load(body.yaml) as Record<string, unknown>;

if (hasFeedTemplate(parsed) && !body.values) {
  // Return template info so frontend can show the form
  return c.json({
    requiresTemplateValues: true,
    template: extractFeedTemplate(parsed),
  });
}

if (hasFeedTemplate(parsed) && body.values) {
  // Render template (allow plain with warning for manual import)
  const storage = body.secretStorage ?? {};
  const hasPlainSecrets = Object.values(storage).some((v) => v === "plain");

  const warnings: string[] = [];
  if (hasPlainSecrets) {
    warnings.push("Plain secret storage: values will be written as plaintext to the config file.");
  }

  const feedId = crypto.randomUUID();
  const rendered = renderFeedConfigTemplate(parsed, {
    feedId,
    encryptionKey: process.env.ENCRYPTION_KEY ?? "",
    values: body.values,
    secretStorage: storage,
    origin: { type: "manual" },
  });

  // Continue with normal import flow using rendered config...
  return c.json({ ok: true, feedId, warnings });
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/configs.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add routes/configs.ts tests/configs.test.ts
git commit -m "feat: detect and render templates during manual config import"
```

---

### Task 7: Catalog CI validation update

**Files:**
- Modify: `scripts/validate-community-catalog.ts`

- [ ] **Step 1: Write failing test for CI script**

```ts
// tests/validate-community-catalog.test.ts
import { validateCatalogEntry } from "../scripts/validate-community-catalog";

describe("catalog template validation", () => {
  test("rejects hardcoded Authorization header", () => {
    const config = {
      feedType: "rest",
      headers: { Authorization: "Bearer ghp_realtoken" },
    };
    const result = validateCatalogEntry(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Authorization"))).toBe(true);
  });

  test("allows template placeholder in Authorization", () => {
    const config = {
      template: { variables: { token: { label: "Token", type: "secret" } } },
      feedType: "rest",
      headers: { Authorization: "{{ secret.token | bearer }}" },
    };
    const result = validateCatalogEntry(config);
    expect(result.valid).toBe(true);
  });

  test("rejects undeclared placeholder in catalog config", () => {
    const config = {
      template: { variables: { owner: { label: "Owner", type: "string" } } },
      config: { route: "/repos/{{ owner }}/{{ undeclared }}" },
    };
    const result = validateCatalogEntry(config);
    expect(result.valid).toBe(false);
  });

  test("rejects protected values in catalog config", () => {
    const config = {
      feedType: "rest",
      headers: { Authorization: { type: "protected", value: "ENC:v1:..." } },
    };
    const result = validateCatalogEntry(config);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/validate-community-catalog.test.ts
```

Expected: FAIL

- [ ] **Step 3: Update validate-community-catalog.ts**

Add to the existing validation logic:

```ts
import { validateFeedTemplate, findTemplateExpressions } from "../utilities/feed-template.utility";

const SENSITIVE_HEADER_PATTERN = /^(authorization|x-api-key|cookie)$/i;
const HARDCODED_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9_\-]{10,}|token\s+[A-Za-z0-9_\-]{10,}/i;

export function validateCatalogEntry(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for hardcoded sensitive headers
  const expressions = findAllStringValues(config as Record<string, unknown>);
  for (const { path, value } of expressions) {
    const headerMatch = /headers\.(\w+)/i.exec(path);
    if (headerMatch && SENSITIVE_HEADER_PATTERN.test(headerMatch[1])) {
      if (!value.includes("{{") && HARDCODED_TOKEN_PATTERN.test(value)) {
        errors.push(`Hardcoded secret detected in ${path}. Use a template placeholder instead.`);
      }
    }
  }

  // Check for stored ProtectedValues (type: protected)
  if (containsProtectedValues(config)) {
    errors.push("Catalog config must not contain encrypted protected values.");
  }

  // Validate template if present
  const templateResult = validateFeedTemplate(config);
  for (const err of templateResult.errors) {
    errors.push(`Template validation: ${err.message}`);
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/validate-community-catalog.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-community-catalog.ts tests/validate-community-catalog.test.ts
git commit -m "feat: add template-aware catalog CI validation"
```

---

### Task 8: Frontend template import dialog

> **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing components in this task.**

**Files:**
- Create: `frontend/src/components/catalog/TemplateImportDialog.tsx`
- Create: `frontend/src/components/catalog/TemplateVariableField.tsx`
- Create: `frontend/src/components/catalog/SecretTemplateVariableField.tsx`
- Modify: `frontend/src/components/catalog/CatalogImportDialog.tsx`

- [ ] **Step 1: Invoke `superpowers:frontend-design` for component layout**

Use the skill to design the `TemplateImportDialog` layout before implementing.

- [ ] **Step 2: Create `TemplateVariableField.tsx`**

```tsx
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FeedConfigTemplateVariable } from "@/models/feed-template.model";

interface Props {
  name: string;
  variable: FeedConfigTemplateVariable;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

export function TemplateVariableField({ name, variable, value, onChange, error }: Props) {
  const id = `template-var-${name}`;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {variable.label}
        {variable.required && <span className="text-destructive ml-1">*</span>}
      </label>
      {variable.description && (
        <p className="text-xs text-muted-foreground">{variable.description}</p>
      )}
      {variable.type === "boolean" ? (
        <Checkbox
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
      ) : variable.type === "select" ? (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={variable.placeholder ?? "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {variable.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : variable.type === "textarea" ? (
        <Textarea
          id={id}
          value={String(value ?? "")}
          placeholder={variable.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-sm"
          rows={4}
        />
      ) : (
        <Input
          id={id}
          type={variable.type === "number" ? "number" : variable.type === "url" ? "url" : "text"}
          value={String(value ?? "")}
          placeholder={variable.placeholder}
          onChange={(e) => onChange(variable.type === "number" ? Number(e.target.value) : e.target.value)}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create `SecretTemplateVariableField.tsx`**

```tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FeedConfigTemplateVariable } from "@/models/feed-template.model";

interface Props {
  name: string;
  variable: FeedConfigTemplateVariable;
  value: string;
  storage: "protected" | "env";
  onChange: (value: string, storage: "protected" | "env") => void;
  error?: string;
}

export function SecretTemplateVariableField({ name, variable, value, storage, onChange, error }: Props) {
  const id = `template-secret-${name}`;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {variable.label}
        {variable.required && <span className="text-destructive ml-1">*</span>}
      </label>
      {variable.description && (
        <p className="text-xs text-muted-foreground">{variable.description}</p>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          type={storage === "protected" ? "password" : "text"}
          value={value}
          placeholder={storage === "env" ? "GITHUB_TOKEN" : variable.placeholder ?? ""}
          onChange={(e) => onChange(e.target.value, storage)}
          className="flex-1"
        />
        <Select value={storage} onValueChange={(v) => onChange(value, v as "protected" | "env")}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="protected">Encrypt in config</SelectItem>
            <SelectItem value="env">Environment variable</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {storage === "env" && (
        <p className="text-xs text-muted-foreground">
          Enter the environment variable name (e.g. GITHUB_TOKEN). Mkfd will read it at runtime.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Create `TemplateImportDialog.tsx`**

```tsx
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TemplateVariableField } from "./TemplateVariableField";
import { SecretTemplateVariableField } from "./SecretTemplateVariableField";
import type { FeedConfigTemplate } from "@/models/feed-template.model";

interface Props {
  open: boolean;
  catalogId: string;
  template: FeedConfigTemplate;
  onImport: (feedId: string) => void;
  onCancel: () => void;
}

export function TemplateImportDialog({ open, catalogId, template, onImport, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [secretStorage, setSecretStorage] = useState<Record<string, "protected" | "env">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);

  // Initialize defaults
  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    const storageDefaults: Record<string, "protected" | "env"> = {};
    for (const [name, variable] of Object.entries(template.variables)) {
      if (variable.defaultValue !== undefined) defaults[name] = variable.defaultValue;
      if (variable.type === "secret") storageDefaults[name] = "protected";
    }
    setValues(defaults);
    setSecretStorage(storageDefaults);
  }, [template]);

  async function handleImport() {
    setImporting(true);
    try {
      const response = await fetch(`/community-catalog/import/${catalogId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, secretStorage }),
      });
      const body = await response.json();
      if (!response.ok) {
        const fieldErrors: Record<string, string> = {};
        for (const err of body.errors ?? []) {
          fieldErrors[err.path] = err.message;
        }
        setErrors(fieldErrors);
      } else {
        onImport(body.feedId);
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure feed template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {Object.entries(template.variables).map(([name, variable]) =>
            variable.type === "secret" ? (
              <SecretTemplateVariableField
                key={name}
                name={name}
                variable={variable}
                value={String(values[name] ?? "")}
                storage={secretStorage[name] ?? "protected"}
                onChange={(v, s) => {
                  setValues((prev) => ({ ...prev, [name]: v }));
                  setSecretStorage((prev) => ({ ...prev, [name]: s }));
                }}
                error={errors[name]}
              />
            ) : (
              <TemplateVariableField
                key={name}
                name={name}
                variable={variable}
                value={values[name]}
                onChange={(v) => setValues((prev) => ({ ...prev, [name]: v }))}
                error={errors[name]}
              />
            )
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? "Importing..." : "Import feed"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Update `CatalogImportDialog.tsx`** to route to `TemplateImportDialog` when `requiresTemplateValues`:

```tsx
// In the import handler:
if (catalogEntry.requiresTemplateValues) {
  setShowTemplateDialog(true);
} else {
  // existing import flow
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/catalog/
git commit -m "feat: add TemplateImportDialog, TemplateVariableField, SecretTemplateVariableField"
```

---

### Task 9: Verification

- [ ] **Step 1: Run all template tests**

```bash
bun test tests/feed-template.test.ts
```

Expected: PASS

- [ ] **Step 2: Run catalog tests**

```bash
bun test tests/catalog.test.ts
```

Expected: PASS

- [ ] **Step 3: Run all tests (regression check)**

```bash
bun test
```

Expected: PASS with no regressions

- [ ] **Step 4: Manual verification**

- Import a catalog entry with `template.variables` — confirm dynamic form appears
- Fill in values and confirm rendered preview masks secrets
- Save and confirm saved config has no `template` block
- Import same catalog entry without values — confirm error response with field-level errors
- Manual import: paste YAML with `template.variables`, confirm form appears
- Run worker on imported feed — confirm it runs normally (resolved config, no template block)
