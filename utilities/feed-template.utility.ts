import type {
  FeedConfigTemplate,
  FeedConfigTemplateVariable,
  FeedTemplateValidationIssue,
  FeedTemplateValidationResult,
  RenderFeedConfigTemplateOptions,
  TemplateExpression,
} from "../models/feed-template.model";
import { protectValue } from "./protected-values.utility";

const EXPR = /\{\{\s*(secret\.)?([A-Za-z0-9_-]+)(?:\s*\|\s*([^}]+))?\s*\}\}/g;
const FULL_EXPR = /^\{\{\s*(secret\.)?([A-Za-z0-9_-]+)(?:\s*\|\s*([^}]+))?\s*\}\}$/;
const ALLOWED_FILTERS = new Set(["trim", "lower", "upper", "slug", "urlEncode", "bearer"]);

export function hasFeedTemplate(input: unknown): input is { template: FeedConfigTemplate } {
  return Boolean(input && typeof input === "object" && (input as any).template?.variables);
}

export function parseTemplateExpression(raw: string): TemplateExpression | null {
  const match = raw.match(FULL_EXPR);
  if (!match) return null;
  const filters = String(match[3] ?? "")
    .split("|")
    .map((filter) => filter.trim())
    .filter(Boolean);
  return {
    path: "",
    raw,
    namespace: match[1] ? "secret" : "value",
    variableName: match[2],
    filters,
  };
}

export function findTemplateExpressions(input: unknown, path = "$"): TemplateExpression[] {
  if (typeof input === "string") {
    return [...input.matchAll(EXPR)].map((match) => ({
      path,
      raw: match[0],
      namespace: match[1] ? "secret" : "value",
      variableName: match[2],
      filters: String(match[3] ?? "")
        .split("|")
        .map((filter) => filter.trim())
        .filter(Boolean),
    }));
  }
  if (Array.isArray(input)) {
    return input.flatMap((item, index) => findTemplateExpressions(item, `${path}[${index}]`));
  }
  if (input && typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
      findTemplateExpressions(value, path === "$" ? key : `${path}.${key}`),
    );
  }
  return [];
}

function applyFilter(value: unknown, filter: string): unknown {
  const text = String(value ?? "");
  if (filter === "trim") return text.trim();
  if (filter === "lower") return text.toLowerCase();
  if (filter === "upper") return text.toUpperCase();
  if (filter === "slug") return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (filter === "urlEncode") return encodeURIComponent(text);
  if (filter === "bearer") return `Bearer ${text}`;
  return value;
}

function coerce(value: unknown, variable: FeedConfigTemplateVariable): unknown {
  if (value === undefined || value === null || value === "") return variable.defaultValue;
  if (variable.type === "number") return Number(value);
  if (variable.type === "boolean") return value === true || String(value).toLowerCase() === "true";
  return value;
}

export function validateFeedTemplate(template: FeedConfigTemplate, values: Record<string, unknown>): FeedTemplateValidationResult {
  const errors: FeedTemplateValidationResult["errors"] = [];
  for (const [name, variable] of Object.entries(template.variables ?? {})) {
    const value = coerce(values[name], variable);
    if (variable.required && (value === undefined || value === "")) {
      errors.push({ path: `template.variables.${name}`, message: `${variable.label} is required`, severity: "error" });
    }
    if (variable.type === "url" && value) {
      try {
        const url = new URL(String(value));
        if (variable.validation?.allowedHosts && !variable.validation.allowedHosts.includes(url.hostname)) {
          errors.push({ path: name, message: "URL host is not allowed", severity: "error" });
        }
        if (variable.validation?.disallowedHosts?.includes(url.hostname)) {
          errors.push({ path: name, message: "URL host is disallowed", severity: "error" });
        }
      } catch {
        errors.push({ path: name, message: "Value must be a valid URL", severity: "error" });
      }
    }
    if (variable.validation?.pattern && value && !new RegExp(variable.validation.pattern).test(String(value))) {
      errors.push({ path: name, message: "Value does not match required pattern", severity: "error" });
    }
    if (variable.type === "select" && value && variable.options?.length) {
      const allowed = new Set(variable.options.map((option) => option.value));
      if (!allowed.has(String(value))) {
        errors.push({ path: name, message: "Value must be one of the available options", severity: "error" });
      }
    }
    if (variable.type === "number" && value !== undefined) {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) {
        errors.push({ path: name, message: "Value must be a number", severity: "error" });
      }
      if (variable.validation?.min !== undefined && numeric < variable.validation.min) {
        errors.push({ path: name, message: `Value must be at least ${variable.validation.min}`, severity: "error" });
      }
      if (variable.validation?.max !== undefined && numeric > variable.validation.max) {
        errors.push({ path: name, message: `Value must be at most ${variable.validation.max}`, severity: "error" });
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

function validateTemplateExpressions(input: Record<string, unknown>, template: FeedConfigTemplate): FeedTemplateValidationIssue[] {
  return findTemplateExpressions(input)
    .filter((expr) => expr.path !== "template" && !expr.path.startsWith("template."))
    .flatMap((expr) => {
      const issues: FeedTemplateValidationIssue[] = [];
      if (!template.variables[expr.variableName]) {
        issues.push({
          path: expr.path,
          message: `Template variable "${expr.variableName}" is not defined`,
          severity: "error",
        });
      }
      for (const filter of expr.filters) {
        if (!ALLOWED_FILTERS.has(filter)) {
          issues.push({
            path: expr.path,
            message: `Template filter "${filter}" is not supported`,
            severity: "error",
          });
        }
      }
      return issues;
    });
}

function renderString(input: string, template: FeedConfigTemplate, opts: RenderFeedConfigTemplateOptions): unknown {
  const matches = [...input.matchAll(EXPR)];
  if (matches.length === 1 && matches[0][0] === input.trim()) {
    return renderExpression(matches[0], template, opts);
  }
  return input.replace(EXPR, (_raw, secretPrefix, name, filters) => {
    const rendered = renderExpression([_raw, secretPrefix, name, filters] as any, template, opts);
    return typeof rendered === "object" ? JSON.stringify(rendered) : String(rendered ?? "");
  });
}

function renderExpression(match: RegExpMatchArray, template: FeedConfigTemplate, opts: RenderFeedConfigTemplateOptions): unknown {
  const isSecret = Boolean(match[1]);
  const name = match[2];
  const filters = String(match[3] ?? "").split("|").map((f) => f.trim()).filter(Boolean);
  const variable = template.variables[name];
  if (!variable) throw new Error(`Template variable "${name}" is not defined`);
  for (const filter of filters) {
    if (!ALLOWED_FILTERS.has(filter)) throw new Error(`Template filter "${filter}" is not supported`);
  }
  let value = coerce(opts.values[name], variable);
  for (const filter of filters) value = applyFilter(value, filter);
  if (!isSecret) return value;
  const storage = opts.secretStorage?.[name] ?? (variable?.encrypted ? "protected" : "plain");
  if (storage === "env") return { type: "env", value: String(opts.values[name] ?? name), prefix: filters.includes("bearer") ? "Bearer " : undefined };
  if (storage === "protected") return protectValue(String(value ?? ""), opts.encryptionKey);
  return value;
}

function walk(input: unknown, template: FeedConfigTemplate, opts: RenderFeedConfigTemplateOptions): unknown {
  if (typeof input === "string") return renderString(input, template, opts);
  if (Array.isArray(input)) return input.map((item) => walk(item, template, opts));
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .filter(([key]) => key !== "template")
      .map(([key, value]) => [key, walk(value, template, opts)]));
  }
  return input;
}

export function renderFeedConfigTemplate(input: Record<string, unknown>, opts: RenderFeedConfigTemplateOptions): Record<string, unknown> {
  if (!hasFeedTemplate(input)) return input;
  const validation = validateFeedTemplate(input.template, opts.values);
  const expressionErrors = validateTemplateExpressions(input, input.template);
  if (!validation.valid || expressionErrors.length > 0) {
    throw new Error([...validation.errors, ...expressionErrors].map((err) => err.message).join("; "));
  }
  return {
    ...walk(input, input.template, opts) as Record<string, unknown>,
    feedId: opts.feedId,
    schemaVersion: 2,
    metadata: {
      ...((input.metadata as Record<string, unknown>) ?? {}),
      origin: opts.origin,
    },
  };
}
