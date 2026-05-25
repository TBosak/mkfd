import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, ApiFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
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
    if (!ws.article?.iterator?.selector) err("article.iterator.selector", "iterator selector is required for webScraping feeds");
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

  return { valid: errors.length === 0, errors, warnings };
}
