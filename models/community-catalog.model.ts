import type { FeedConfig, FeedType } from "./feed-config.model";
import type { FeedConfigTemplate } from "./feed-template.model";

export type CatalogManifest = {
  schemaVersion: 1;
  updatedAt: string;
  feeds: CatalogManifestEntry[];
};

export type CatalogManifestEntry = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  feedType: FeedType;
  path: string;
  sourceHomepage?: string;
  requiresSecrets: boolean;
  requiresPrivateNetwork: boolean;
  requiresTemplateValues?: boolean;
  templateVariables?: string[];
  schemaVersion: number;
  catalogVersion: number;
};

export type CatalogFeedDetail = {
  entry: CatalogManifestEntry;
  yaml: string;
  config: Record<string, unknown>;
  template?: FeedConfigTemplate;
};

export type CatalogSubmissionInput = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  sourceHomepage?: string;
  submitterName?: string;
};

export type CatalogImportRequest = {
  values?: Record<string, unknown>;
  secretStorage?: Record<string, "protected" | "env" | "plain">;
};

export type CatalogSanitizeResult = {
  eligible: boolean;
  sanitizedYaml?: string;
  manifestEntry?: Omit<CatalogManifestEntry, "id" | "path">;
  errors: CatalogSanitizeIssue[];
  warnings: CatalogSanitizeIssue[];
  removed: CatalogSanitizeRemoval[];
};

export type CatalogSanitizeIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type CatalogSanitizeRemoval = {
  path: string;
  reason: string;
};

export type CatalogSubmissionBundle = {
  manifestEntry: CatalogManifestEntry;
  feedYaml: string;
  readme: string;
};

export type CatalogSanitizableConfig = FeedConfig & Record<string, unknown>;
