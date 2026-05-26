import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, ApiFeedConfig, EmailFeedConfig, FeedTransformerFeedConfig } from "../models/feed-config.model";
import { findPlainSensitiveValues } from "./sensitive-config.utility";

export type ValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function validateFeedConfig(config: FeedConfig): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const err = (path: string, message: string) => errors.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => warnings.push({ path, message, severity: "warning" });

  if (!config.feedId)   err("feedId",      "feedId is required");
  if (config.feedId && !/^[A-Za-z0-9_-]+$/.test(config.feedId)) {
    err("feedId", "feedId may only contain letters, numbers, underscores, and hyphens");
  }
  if (!config.feedName) err("feedName",    "feedName is required");
  if (!config.refreshTime || config.refreshTime <= 0) err("refreshTime", "refreshTime must be a positive number");

  // Sensitive plain value warnings
  for (const finding of findPlainSensitiveValues(config.headers ?? {})) {
    warn(`headers.${finding.path}`, finding.message);
  }
  for (const finding of findPlainSensitiveValues(config.cookies ?? [])) {
    warn(`cookies.${finding.path}`, finding.message);
  }

  const t = config.feedType;
  const supportedFeedTypes = new Set([
    "webScraping", "rest", "api", "email", "graphql", "calendar", "sitemap",
    "filesystem", "webhook", "feedTransformer", "serviceConnector", "changeDetection",
  ]);
  if (!supportedFeedTypes.has(t)) {
    err("feedType", `Unsupported feedType: ${String(t)}`);
  }

  if (t === "webScraping") {
    const ws = config as WebScrapingFeedConfig;
    if (!ws.config?.baseUrl) err("config.baseUrl", "baseUrl is required for webScraping feeds");
    const jsonLdMode = ws.extraction?.mode && ws.extraction.mode !== "cssSelectors";
    if (!jsonLdMode && !ws.article?.iterator?.selector) err("article.iterator.selector", "iterator selector is required for webScraping feeds");
    if (ws.config?.request?.mode === "form") {
      if (!["GET", "POST"].includes(ws.config.request.method)) err("config.request.method", "form request method must be GET or POST");
      if (!["application/x-www-form-urlencoded", "multipart/form-data", "application/json"].includes(ws.config.request.encoding)) {
        err("config.request.encoding", "unsupported form request encoding");
      }
      if (Object.keys(ws.config.request.fields ?? {}).some((key) => /file/i.test(key))) {
        err("config.request.fields", "file upload fields are not supported");
      }
    }
    if (jsonLdMode) {
      const extraction = ws.extraction as Record<string, unknown>;
      for (const key of ["limit", "concurrency", "timeout", "timeoutMs", "sampleLimit"]) {
        if (key in extraction) err(`extraction.${key}`, "JSON-LD tuning knobs are internal and may not be persisted");
      }
    }
  }

  if (t === "rest" || t === "api") {
    const api = config as RestFeedConfig | ApiFeedConfig;
    if (!api.config?.baseUrl) err("config.baseUrl", "baseUrl is required for REST/API feeds");
    // apiMapping.items is intentionally not required — empty means root response is the array
  }

  if (t === "email") {
    const email = config as EmailFeedConfig;
    if (!email.config?.host)   err("config.host",   "host is required for email feeds");
    if (!email.config?.user)   err("config.user",   "user is required for email feeds");
    if (!email.config?.folder) err("config.folder", "folder is required for email feeds");
    if (!email.config?.password && !email.config?.encryptedPassword) {
      err("config.password", "a password or encryptedPassword is required for email feeds");
    }
  }

  if (t === "feedTransformer") {
    const transformer = config as FeedTransformerFeedConfig;
    const sources = transformer.feedTransformer?.sources ?? [];
    if (!Array.isArray(sources) || sources.length === 0) {
      err("feedTransformer.sources", "at least one source URL is required for feedTransformer feeds");
    }
    sources.forEach((source, index) => {
      if (!source.url) err(`feedTransformer.sources.${index}.url`, "source URL is required");
      if (source.url) {
        try {
          const url = new URL(source.url);
          if (!["http:", "https:"].includes(url.protocol)) {
            err(`feedTransformer.sources.${index}.url`, "source URL must be http or https");
          }
        } catch {
          err(`feedTransformer.sources.${index}.url`, "source URL must be a valid URL");
        }
      }
    });
  }

  if (t === "sitemap") {
    const sitemap = (config as any).sitemap;
    if (!sitemap?.url) err("sitemap.url", "url is required for sitemap feeds");
    if (sitemap?.url && !isHttpUrl(sitemap.url)) err("sitemap.url", "sitemap url must be http or https");
    if (!sitemap?.maxItems || sitemap.maxItems <= 0) err("sitemap.maxItems", "maxItems must be positive");
  }

  if (t === "calendar") {
    const calendar = (config as any).calendar;
    if (!calendar?.url) err("calendar.url", "url is required for calendar feeds");
    if (calendar?.url && !isHttpUrl(calendar.url)) err("calendar.url", "calendar url must be http or https");
    if (!calendar?.maxEvents || calendar.maxEvents <= 0) err("calendar.maxEvents", "maxEvents must be positive");
  }

  if (t === "graphql") {
    const graphql = (config as any).graphql;
    if (!graphql?.endpoint) err("graphql.endpoint", "endpoint is required for GraphQL feeds");
    if (graphql?.endpoint && !isHttpUrl(graphql.endpoint)) err("graphql.endpoint", "GraphQL endpoint must be http or https");
    if (!graphql?.query) err("graphql.query", "query is required for GraphQL feeds");
    if (!graphql?.mapping?.itemPath) err("graphql.mapping.itemPath", "itemPath is required for GraphQL feeds");
  }

  if (t === "webhook") {
    const webhook = (config as any).webhookFeed;
    if (!webhook?.slug) err("webhookFeed.slug", "slug is required for webhook feeds");
    if (!webhook?.tokenHash) err("webhookFeed.tokenHash", "tokenHash is required for webhook feeds");
  }

  if (t === "filesystem") {
    const filesystem = (config as any).filesystem;
    if (!filesystem?.rootPath) err("filesystem.rootPath", "rootPath is required for filesystem feeds");
    if (!filesystem?.maxItems || filesystem.maxItems <= 0) err("filesystem.maxItems", "maxItems must be positive");
  }

  if (t === "serviceConnector") {
    const connector = (config as any).serviceConnector;
    if (!connector?.service) err("serviceConnector.service", "service is required for service connector feeds");
    if (!connector?.preset) err("serviceConnector.preset", "preset is required for service connector feeds");
    if (!connector?.connection?.settings?.serverUrl) err("serviceConnector.connection.settings.serverUrl", "serverUrl is required");
    const fields = connector?.connection?.auth?.fields ?? {};
    if (connector?.connection?.auth?.mode !== "none" && Object.keys(fields).length === 0) {
      err("serviceConnector.connection.auth.fields", "protected auth fields are required");
    }
    for (const [key, value] of Object.entries(fields)) {
      if (!value || typeof value !== "object" || !["protected", "env"].includes((value as any).type)) {
        err(`serviceConnector.connection.auth.fields.${key}`, "auth fields must be ProtectedValue objects");
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
