import * as yaml from "js-yaml";
import type {
  CatalogSanitizeIssue,
  CatalogSanitizeRemoval,
  CatalogSanitizeResult,
  CatalogSubmissionInput,
} from "../../models/community-catalog.model";
import type { FeedConfig } from "../../models/feed-config.model";
import { hasFeedTemplate } from "../feed-template.utility";
import { validateFeedConfig } from "../feed-config-validator.utility";
import { safeFeedId } from "../config-manager.utility";

const UNSUPPORTED_FEED_TYPES = new Set(["email", "serviceConnector"]);
const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

function scanPrivateUrls(value: unknown, path = "$", issues: CatalogSanitizeIssue[] = []): CatalogSanitizeIssue[] {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (isPrivateHost(url.hostname)) {
        issues.push({ path, message: "Private network URLs cannot be submitted to the catalog", severity: "error" });
      }
    } catch {
      // Feed validation handles malformed URLs in known config fields.
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => scanPrivateUrls(item, `${path}[${index}]`, issues));
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) =>
      scanPrivateUrls(nested, path === "$" ? key : `${path}.${key}`, issues),
    );
  }
  return issues;
}

function removePrivateFields(config: Record<string, unknown>, removed: CatalogSanitizeRemoval[]): Record<string, unknown> {
  const clone = structuredClone(config);
  delete clone.feedId;
  delete clone.headers;
  delete clone.cookies;
  delete clone.webhook;
  delete clone.flaresolverr;
  removed.push({ path: "feedId", reason: "Catalog entries receive a local feedId when imported" });
  if ("headers" in config) removed.push({ path: "headers", reason: "Global headers may contain credentials" });
  if ("cookies" in config) removed.push({ path: "cookies", reason: "Cookies are not allowed in catalog submissions" });
  if ("webhook" in config) removed.push({ path: "webhook", reason: "Outgoing webhooks are local runtime behavior" });
  if ("flaresolverr" in config) removed.push({ path: "flaresolverr", reason: "Solver settings are instance-specific" });

  const source = (clone.config && typeof clone.config === "object" ? clone.config : {}) as Record<string, unknown>;
  for (const key of ["headers", "cookies", "request", "proxyId", "userAgent"]) {
    if (key in source) {
      delete source[key];
      removed.push({ path: `config.${key}`, reason: "Request credentials and local network settings are not catalog-safe" });
    }
  }
  return clone;
}

export function sanitizeForCommunityCatalog(
  config: FeedConfig & Record<string, unknown>,
  input: CatalogSubmissionInput,
): CatalogSanitizeResult {
  const errors: CatalogSanitizeIssue[] = [];
  const warnings: CatalogSanitizeIssue[] = [];
  const removed: CatalogSanitizeRemoval[] = [];

  if (!input.title?.trim()) errors.push({ path: "title", message: "Title is required", severity: "error" });
  if (!input.description?.trim()) errors.push({ path: "description", message: "Description is required", severity: "error" });
  if (!input.category?.trim()) errors.push({ path: "category", message: "Category is required", severity: "error" });

  if (UNSUPPORTED_FEED_TYPES.has(config.feedType)) {
    errors.push({ path: "feedType", message: `${config.feedType} feeds cannot be submitted to the community catalog`, severity: "error" });
  }

  const sanitized = removePrivateFields(config, removed);
  const urlIssues = scanPrivateUrls(sanitized);
  errors.push(...urlIssues);

  const validationConfig = {
    ...sanitized,
    feedId: "catalog-validation",
  } as FeedConfig;
  const validation = validateFeedConfig(validationConfig);
  errors.push(...validation.errors.map((issue) => ({ ...issue, severity: "error" as const })));
  warnings.push(...validation.warnings.map((issue) => ({ ...issue, severity: "warning" as const })));

  const id = safeFeedId(input.title);
  const tags = Array.from(new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)));
  const template = hasFeedTemplate(sanitized) ? sanitized.template : undefined;
  const sanitizedYaml = yaml.dump(sanitized, { lineWidth: 120 });

  return {
    eligible: errors.length === 0,
    sanitizedYaml,
    manifestEntry: {
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category.trim(),
      tags,
      feedType: config.feedType,
      sourceHomepage: input.sourceHomepage?.trim() || undefined,
      requiresSecrets: Boolean(template && Object.values(template.variables).some((variable) => variable.type === "secret")),
      requiresPrivateNetwork: false,
      requiresTemplateValues: Boolean(template),
      templateVariables: template ? Object.keys(template.variables) : undefined,
      schemaVersion: Number(config.schemaVersion ?? 2),
      catalogVersion: 1,
    },
    errors,
    warnings,
    removed,
  };
}

export function buildCatalogSubmissionBundle(
  config: FeedConfig & Record<string, unknown>,
  input: CatalogSubmissionInput,
) {
  const result = sanitizeForCommunityCatalog(config, input);
  if (!result.eligible || !result.sanitizedYaml || !result.manifestEntry) {
    return { result };
  }
  const id = safeFeedId(input.title);
  const category = safeFeedId(input.category) || "general";
  return {
    result,
    bundle: {
      manifestEntry: {
        ...result.manifestEntry,
        id,
        path: `feeds/${category}/${id}.yaml`,
      },
      feedYaml: result.sanitizedYaml,
      readme: `# ${input.title}\n\n${input.description}\n\nSource: ${input.sourceHomepage ?? "Not provided"}\n`,
    },
  };
}
