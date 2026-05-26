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
