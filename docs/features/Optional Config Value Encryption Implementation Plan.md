## Goal

Extend Mkfd so users can optionally protect **any user-specific config value** from the GUI, not just headers and cookies.

This means values can be saved as:

```yaml
type: protected
value: ENC:v1:aes-256-gcm:...
```

or referenced from the environment:

```yaml
type: env
value: GITHUB_TOKEN
prefix: "Bearer "
```

The feature should apply across web scraping, form submission, REST/API feeds, GraphQL feeds, service connectors, webhooks, templates, and future config import/export flows.

The key design rule:

```text
Plain config values stay plain.
User-specific/private values may be encrypted.
Secrets and credentials should be encouraged or required to use protected/env storage.
Runtime code resolves protected values only when needed.
API responses and GUI previews never expose decrypted values.
```

---

# 1. User-facing behavior

Anywhere Mkfd asks the user for a config value, the GUI should offer a storage mode when appropriate:

```text
Storage
(•) Plain
( ) Encrypt and store in config
( ) Use environment variable
```

For sensitive-looking values, Mkfd should default to encryption or show a warning:

```text
This field looks sensitive. Store it encrypted?
```

For existing encrypted values, the GUI should show:

```text
********
```

with options:

```text
Keep existing value
Replace encrypted value
Switch to environment variable
Clear value
```

---

# 2. Core YAML format

## Plain value

```yaml
config:
  baseUrl: https://example.com/search
```

## Protected encrypted value

```yaml
config:
  request:
    fields:
      accountId:
        type: protected
        value: ENC:v1:aes-256-gcm:...
```

## Environment variable reference

```yaml
headers:
  Authorization:
    type: env
    value: API_TOKEN
    prefix: "Bearer "
```

At runtime, Mkfd resolves that to:

```text
Bearer ${process.env.API_TOKEN}
```

## Cookie value

```yaml
cookies:
  - name: session
    value:
      type: protected
      value: ENC:v1:aes-256-gcm:...
    domain: example.com
    path: /
```

---

# 3. Supported areas

## MVP scope

Support protected values in:

```text
headers
cookies
web scraping form fields
REST/API headers
REST/API params
REST/API body fields
GraphQL headers
GraphQL variables
webhook URL
webhook headers
template secret variables
```

## Later expansion

Extend to:

```text
config.baseUrl
config.request.actionUrl
service connector settings
email username/password/folder
proxy settings
calendar URLs
filesystem roots
advanced YAML editor values
```

This staged rollout keeps the first implementation manageable while still establishing the universal model.

---

# 4. Add universal ProtectedValue model

Create or update:

```text
models/protected-value.model.ts
```

```ts
export type ProtectedValue =
  | {
      type: "protected";
      value: string;
    }
  | {
      type: "env";
      value: string;
      prefix?: string;
      suffix?: string;
    };

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ProtectedValue
  | ConfigValue[]
  | {
      [key: string]: ConfigValue;
    };

export type ProtectedRecord = Record<string, ConfigValue>;

export type ProtectedKeyValueRow = {
  key: string;
  value: ConfigValue;
};
```

Use narrower types where needed:

```ts
export type HeaderValue = string | ProtectedValue;

export type QueryParamValue =
  | string
  | number
  | boolean
  | ProtectedValue;

export type WebScrapingFormFieldValue =
  | string
  | number
  | boolean
  | ProtectedValue
  | Array<string | number | boolean | ProtectedValue>;
```

---

# 5. Extend config models

Update feed config models to accept `ProtectedValue` in user-controlled locations.

## Web scraping

```ts
export type WebScrapingSourceConfig = {
  baseUrl: string | ProtectedValue;
  title?: string;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  timeoutMs?: number;
  userAgent?: string | ProtectedValue;
  proxyId?: string;
  request?: WebScrapingRequestConfig;
};

export type FeedCookie = {
  name: string;
  value: string | ProtectedValue;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
};
```

## Form submission fields

```ts
export type WebScrapingFormRequestConfig = {
  mode: "form";
  method: "GET" | "POST";
  actionUrl?: string | ProtectedValue;
  encoding:
    | "application/x-www-form-urlencoded"
    | "multipart/form-data"
    | "application/json";
  fields: Record<string, WebScrapingFormFieldValue>;
  submit?: WebScrapingFormSubmitOptions;
};
```

## REST/API config

```ts
export type ApiSourceConfig = {
  baseUrl: string | ProtectedValue;
  method?: string;
  route?: string | ProtectedValue;
  params?: ProtectedRecord;
  headers?: ProtectedRecord;
  apiSpecificHeaders?: ProtectedRecord;
  apiSpecificBody?: ConfigValue;
  body?: ConfigValue;
};
```

## GraphQL

```ts
export type GraphQLFeedConfigBlock = {
  endpoint: string | ProtectedValue;
  headers?: ProtectedRecord;
  query: string;
  variables?: ProtectedRecord;
  operationName?: string;
};
```

## Webhook

```ts
export type OutgoingWebhookConfig = {
  enabled: boolean;
  url?: string | ProtectedValue;
  method?: "POST" | "PUT";
  headers?: ProtectedRecord;
  newItemsOnly?: boolean;
};
```

## Service connectors

```ts
export type ServiceConnectorAuthConfig = {
  mode:
    | "none"
    | "apiKey"
    | "bearerToken"
    | "botToken"
    | "basic"
    | "oauth2"
    | "custom";
  fields: Record<string, ProtectedValue>;
};

export type ServiceConnectorConnectionConfig = {
  label?: string;
  auth: ServiceConnectorAuthConfig;
  settings?: ProtectedRecord;
};
```

For service connector auth, do **not** allow plain values.

---

# 6. Add protected value utility

Create:

```text
utilities/protected-values.utility.ts
```

## Required functions

```ts
import { decrypt, encrypt } from "./security.utility";
import type { ProtectedValue } from "../models/protected-value.model";

export function isProtectedValue(value: unknown): value is ProtectedValue {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    ((value as { type?: unknown }).type === "protected" ||
      (value as { type?: unknown }).type === "env")
  );
}

export function protectValue(
  value: string,
  encryptionKey: string,
): ProtectedValue {
  return {
    type: "protected",
    value: encrypt(value, encryptionKey),
  };
}

export function envValue(
  value: string,
  options?: { prefix?: string; suffix?: string },
): ProtectedValue {
  return {
    type: "env",
    value,
    prefix: options?.prefix,
    suffix: options?.suffix,
  };
}

export function resolveProtectedValue(
  value: ProtectedValue,
  encryptionKey: string,
): string {
  if (value.type === "env") {
    const resolved = process.env[value.value];

    if (!resolved) {
      throw new Error(`Missing environment variable: ${value.value}`);
    }

    return `${value.prefix ?? ""}${resolved}${value.suffix ?? ""}`;
  }

  return decrypt(value.value, encryptionKey);
}

export function resolveProtectedValues<T>(
  input: T,
  options: { encryptionKey: string },
): T {
  if (isProtectedValue(input)) {
    return resolveProtectedValue(input, options.encryptionKey) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => resolveProtectedValues(item, options)) as T;
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        resolveProtectedValues(value, options),
      ]),
    ) as T;
  }

  return input;
}

export function maskProtectedValues<T>(input: T): T {
  if (isProtectedValue(input)) {
    return {
      ...input,
      value: "********",
    } as T;
  }

  if (Array.isArray(input)) {
    return input.map(maskProtectedValues) as T;
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        maskProtectedValues(value),
      ]),
    ) as T;
  }

  return input;
}
```

---

# 7. Preserve masked values during edits

When editing an existing config, the frontend receives masked values:

```yaml
Authorization:
  type: protected
  value: "********"
```

If the user saves without replacing the value, the backend must preserve the existing ciphertext.

Add:

```ts
export function preserveMaskedProtectedValues<T>(incoming: T, existing: T): T {
  if (
    isProtectedValue(incoming) &&
    incoming.type === "protected" &&
    incoming.value === "********" &&
    isProtectedValue(existing)
  ) {
    return existing as T;
  }

  if (Array.isArray(incoming) && Array.isArray(existing)) {
    return incoming.map((item, index) =>
      preserveMaskedProtectedValues(item, existing[index]),
    ) as T;
  }

  if (
    incoming &&
    existing &&
    typeof incoming === "object" &&
    typeof existing === "object"
  ) {
    return Object.fromEntries(
      Object.entries(incoming as Record<string, unknown>).map(([key, value]) => [
        key,
        preserveMaskedProtectedValues(
          value,
          (existing as Record<string, unknown>)[key],
        ),
      ]),
    ) as T;
  }

  return incoming;
}
```

This allows a simple edit flow:

```text
GET config -> mask protected values
User edits config
POST config back
Backend preserves masked protected values from existing config
Backend encrypts newly submitted protected values
Backend writes YAML
```

---

# 8. Sensitive value detection

Add:

```text
utilities/sensitive-config.utility.ts
```

```ts
const sensitivePatterns = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "pass",
  "session",
  "csrf",
  "nonce",
  "client_secret",
  "access_token",
  "refresh_token",
  "bearer",
  "basic",
];

export function isSensitiveConfigPath(path: string): boolean {
  const normalized = path.toLowerCase();

  return sensitivePatterns.some((pattern) => normalized.includes(pattern));
}
```

Add recursive scanner:

```ts
export type PlainSensitiveValueFinding = {
  path: string;
  message: string;
};

export function findPlainSensitiveValues(
  input: unknown,
  path = "",
): PlainSensitiveValueFinding[] {
  if (isProtectedValue(input)) {
    return [];
  }

  if (
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    if (path && isSensitiveConfigPath(path)) {
      return [
        {
          path,
          message: "This value looks sensitive. Consider encrypting it.",
        },
      ];
    }

    return [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item, index) =>
      findPlainSensitiveValues(item, `${path}.${index}`),
    );
  }

  if (input && typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).flatMap(
      ([key, value]) => findPlainSensitiveValues(value, path ? `${path}.${key}` : key),
    );
  }

  return [];
}
```

Use this in validation and GUI warnings.

---

# 9. Runtime resolution strategy

Do **not** resolve the entire feed config globally. Resolve close to the code that needs the values.

This reduces accidental logging of secrets.

## Web scraping fetcher

```ts
const headers = resolveProtectedValues(feedConfig.headers ?? {}, {
  encryptionKey,
});

const configHeaders = resolveProtectedValues(feedConfig.config.headers ?? {}, {
  encryptionKey,
});

const baseUrl = resolveProtectedValues(feedConfig.config.baseUrl, {
  encryptionKey,
});
```

## Form submission

```ts
const fields = resolveProtectedValues(request.fields, {
  encryptionKey,
});
```

## API worker

```ts
const apiHeaders = resolveProtectedValues(
  {
    ...(feedConfig.headers ?? {}),
    ...(feedConfig.config.apiSpecificHeaders ?? {}),
  },
  { encryptionKey },
);

const params = resolveProtectedValues(feedConfig.config.params ?? {}, {
  encryptionKey,
});

const body = resolveProtectedValues(feedConfig.config.apiSpecificBody ?? {}, {
  encryptionKey,
});
```

## Webhook delivery

```ts
const webhook = resolveProtectedValues(feedConfig.webhook, {
  encryptionKey,
});
```

## Service connectors

```ts
const connection = resolveProtectedValues(
  feedConfig.serviceConnector.connection,
  { encryptionKey },
);
```

---

# 10. API masking rules

Any endpoint that returns feed configs must mask protected values.

Update:

```text
GET /configs
GET /configs/:id
GET /active-feeds
GET /feeds
GET /community-catalog/import preview
POST /preview if response includes config
```

Pattern:

```ts
return ctx.json(maskProtectedValues(feedConfig));
```

For preview, do not return ciphertext. Show:

```yaml
Authorization:
  type: protected
  value: "********"
```

---

# 11. GUI components

Add shared components:

```text
ProtectedValueInput.tsx
ProtectedKeyValueEditor.tsx
ProtectedCookieEditor.tsx
ProtectedValueStorageSelect.tsx
SensitiveValueWarning.tsx
```

## `ProtectedValueInput`

Use for single fields.

```ts
export type ProtectedValueInputProps = {
  label: string;
  value: string | ProtectedValue | undefined;
  sensitive?: boolean;
  allowPlain?: boolean;
  allowProtected?: boolean;
  allowEnv?: boolean;
  onChange: (value: ProtectedValueInputValue) => void;
};

export type ProtectedValueInputValue =
  | {
      storage: "plain";
      value: string;
    }
  | {
      storage: "protected";
      value: string;
    }
  | {
      storage: "env";
      value: string;
      prefix?: string;
      suffix?: string;
    }
  | {
      storage: "keep";
    };
```

## `ProtectedKeyValueEditor`

Use for headers, params, form fields, GraphQL variables, webhook headers.

```ts
export type ProtectedKeyValueEditorRow = {
  id: string;
  key: string;
  value: string;
  storage: "plain" | "protected" | "env" | "keep";
  prefix?: string;
  suffix?: string;
  sensitive?: boolean;
};
```

Columns:

```text
Name | Value | Storage | Notes | Remove
```

Storage options:

```text
Plain
Encrypted
Environment variable
Keep existing
```

## `ProtectedCookieEditor`

Specialized editor:

```text
Name | Value | Storage | Domain | Path | Secure | HttpOnly | Remove
```

---

# 12. Frontend integration points

Use the shared protected-value components in:

```text
FeedBuilderForm.tsx
WebScrapingForm.tsx
EmailForm.tsx
FeedBuilder API tab
Future GraphQLForm.tsx
Future ServiceConnectorBuilder.tsx
Future WebhookConfigSection.tsx
TemplateImportDialog.tsx
ManualConfigImportDialog.tsx
```

## Web scraping form submission fields

Rows should support:

```text
Plain
Encrypted
Environment variable
```

Example:

```text
accountId | ******** | Encrypted
q         | city council | Plain
token     | API_TOKEN | Env
```

## Headers

Authorization should default to sensitive:

```text
Authorization | ******** | Encrypted
```

## Cookies

Cookie values should default to sensitive:

```text
session | ******** | Encrypted
```

---

# 13. Backend casting behavior

Create a helper:

```text
utilities/protected-input-caster.utility.ts
```

```ts
export type ProtectedInputValue =
  | {
      storage: "plain";
      value: string;
    }
  | {
      storage: "protected";
      value: string;
    }
  | {
      storage: "env";
      value: string;
      prefix?: string;
      suffix?: string;
    }
  | {
      storage: "keep";
    };

export function castProtectedInputValue(
  input: ProtectedInputValue,
  existingValue: unknown,
  encryptionKey: string,
): string | ProtectedValue | undefined {
  if (input.storage === "keep") {
    return isProtectedValue(existingValue) ? existingValue : undefined;
  }

  if (input.storage === "protected") {
    return protectValue(input.value, encryptionKey);
  }

  if (input.storage === "env") {
    return envValue(input.value, {
      prefix: input.prefix,
      suffix: input.suffix,
    });
  }

  return input.value;
}
```

For key-value editors:

```ts
export function castProtectedRecordInput(
  rows: ProtectedKeyValueEditorRow[],
  existing: ProtectedRecord,
  encryptionKey: string,
): ProtectedRecord {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim())
      .map((row) => [
        row.key.trim(),
        castProtectedInputValue(
          {
            storage: row.storage,
            value: row.value,
            prefix: row.prefix,
            suffix: row.suffix,
          },
          existing[row.key],
          encryptionKey,
        ),
      ]),
  );
}
```

---

# 14. Validation behavior

Update `feed-config-validator.utility.ts`.

## Warnings

Warn when sensitive-looking values are plain:

```text
headers.Authorization is stored plain.
config.request.fields.token is stored plain.
webhook.url is stored plain.
cookies[0].value is stored plain.
```

## Errors

Reject plain values for fields that must be protected:

```text
serviceConnector.connection.auth.fields.*
email password
OAuth client secret
webhook signing secret
```

## Runtime readiness warnings

Warn or error if:

```text
env value references missing environment variable
protected value cannot be decrypted
protected value uses unknown encryption format
```

Add a validation mode:

```ts
export type FeedConfigValidationMode =
  | "save"
  | "runtime"
  | "catalog";
```

Rules:

```text
save: allow env references even if missing, warn
runtime: missing env references are errors
catalog: protected ciphertext is invalid, template variables are allowed
```

---

# 15. Import/export rules

## Full local export

Preserve encrypted values:

```text
Useful for backing up one Mkfd instance.
```

## Sanitized export

Mask or remove protected values:

```yaml
Authorization:
  type: protected
  value: "********"
```

## Community catalog export

Reject protected values unless converted into template variables.

Allowed:

```yaml
Authorization: "{{ secret.token | bearer }}"
```

Rejected:

```yaml
Authorization:
  type: protected
  value: ENC:v1:aes-256-gcm:...
```

Reason:

```text
Encrypted values are instance-specific and useless to other catalog users.
```

---

# 16. Template integration

The parameterized template system should use the same protected value model.

Template:

```yaml
template:
  variables:
    token:
      label: GitHub token
      type: secret
      required: true
      encrypted: true

headers:
  Authorization: "{{ secret.token | bearer }}"
```

Import result, encrypted:

```yaml
headers:
  Authorization:
    type: protected
    value: ENC:v1:aes-256-gcm:...
```

Import result, env:

```yaml
headers:
  Authorization:
    type: env
    value: GITHUB_TOKEN
    prefix: "Bearer "
```

For normal variables, optionally allow the user to protect them:

```yaml
config:
  baseUrl: "{{ privateBaseUrl }}"
```

Import form:

```text
Private Base URL
[ http://intranet.local/search ]

Storage
Plain | Encrypted | Environment variable
```

---

# 17. Community catalog policy

Catalog validation should reject:

```text
ProtectedValue ciphertext
plain Authorization headers
plain Cookie headers
plain X-Api-Key headers
hard-coded private tokens
hard-coded private URLs unless templated/local-only policy allows them
```

Catalog validation should allow:

```text
template secret variables
secret placeholders
env examples only in docs, not required actual env references
```

Examples:

Allowed:

```yaml
headers:
  Authorization: "{{ secret.token | bearer }}"
```

Rejected:

```yaml
headers:
  Authorization:
    type: protected
    value: ENC:v1:aes-256-gcm:...
```

Rejected:

```yaml
headers:
  Authorization: Bearer ghp_actualToken
```

---

# 18. Security rules

```text
Never log resolved protected values.
Never return decrypted values from API endpoints.
Never include resolved values in preview responses.
Never expose ciphertext in community catalog submissions.
Mask protected values in GUI.
Preserve masked values on edit.
Resolve secrets only immediately before outbound request/use.
Warn on sensitive-looking plain values.
Require protected/env storage for service connector auth.
Require protected/env storage for email passwords.
```

---

# 19. Tests

## Protected value utility tests

```text
Detects ProtectedValue.
Encrypts value.
Decrypts protected value.
Resolves env value.
Applies env prefix.
Applies env suffix.
Recursively resolves nested objects.
Recursively resolves arrays.
Masks nested protected values.
Preserves masked protected values during update.
```

## Sensitive scanner tests

```text
Finds plain Authorization header.
Finds plain cookie value.
Finds plain token form field.
Ignores protected token form field.
Ignores non-sensitive plain field.
```

## Runtime integration tests

```text
Web scraping headers resolve before fetch.
Web scraping form fields resolve before submit.
REST API params resolve before request.
REST API body resolves before request.
GraphQL variables resolve before request.
Webhook URL resolves before delivery.
Service connector auth resolves before connector call.
```

## GUI/caster tests

```text
Plain input saves plain.
Protected input saves encrypted.
Env input saves env reference.
Keep existing preserves ciphertext.
Masked protected value is not overwritten.
Sensitive row shows warning.
```

## Validation tests

```text
Plain sensitive header creates warning.
Plain service connector auth creates error.
Missing env var warns on save.
Missing env var errors at runtime.
Community catalog rejects ProtectedValue ciphertext.
Community catalog allows secret template placeholder.
```

---

# 20. Implementation phases

## Phase 1: Core model

```text
Add models/protected-value.model.ts.
Define ProtectedValue.
Define ConfigValue.
Define ProtectedRecord.
Update headers/cookies/form fields/API params/API body/webhook models.
```

## Phase 2: Protected values utility

```text
Add protected-values.utility.ts.
Implement protectValue.
Implement envValue.
Implement isProtectedValue.
Implement resolveProtectedValue.
Implement resolveProtectedValues.
Implement maskProtectedValues.
Implement preserveMaskedProtectedValues.
```

## Phase 3: Runtime resolution

```text
Update web scraping fetcher.
Update form submission fetcher.
Update API worker.
Update GraphQL fetcher when added.
Update webhook delivery.
Update service connector runner when added.
Update email config handling later.
```

## Phase 4: API masking

```text
Mask protected values in all config-returning endpoints.
Preserve masked values when saving edits.
Ensure previews never return resolved secrets.
```

## Phase 5: GUI components

```text
Add ProtectedValueInput.
Add ProtectedKeyValueEditor.
Add ProtectedCookieEditor.
Add SensitiveValueWarning.
Replace existing header/cookie editors with protected editors.
Use protected editor in web scraping form fields.
Use protected editor in REST/API headers/params/body.
```

## Phase 6: Save/cast integration

```text
Add protected-input-caster.utility.ts.
Update feed-config-caster.utility.ts.
Encrypt protected values before YAML dump.
Save env references as ProtectedValue.
Preserve existing masked protected values.
```

## Phase 7: Validation and warnings

```text
Add sensitive-config.utility.ts.
Add plain sensitive value scanner.
Update feed config validator.
Add save/runtime/catalog validation modes.
```

## Phase 8: Import/export/template integration

```text
Wire template secret variables to ProtectedValue.
Allow normal template variables to be protected.
Update sanitized export.
Update community catalog sanitizer.
Update catalog CI rules.
```

## Phase 9: Documentation

```text
Document ProtectedValue YAML format.
Document encrypted vs env storage.
Document where protected values are supported.
Document limitations for migrating encrypted configs between instances.
Document community catalog restrictions.
```

---

# 21. README to-do item

Add:

```md
- [ ] Universal protected config values
  - Let users optionally encrypt or environment-reference user-specific values throughout feed configs.
  - Support protected values in headers, cookies, web scraping form fields, REST/API params and bodies, GraphQL variables, webhooks, templates, and service connectors.
  - Add shared GUI controls for Plain, Encrypted, and Environment Variable storage modes.
  - Mask protected values in API responses and preserve existing encrypted values during edits.
  - Resolve protected values only at runtime immediately before requests, webhook delivery, or connector execution.
  - Warn when sensitive-looking fields are stored plain and require protected/env storage for credentials.
```

---

# 22. Acceptance criteria

This feature is done when:

```text
Users can choose Plain, Encrypted, or Environment Variable storage for supported config values.
Headers can use protected/env values.
Cookies can use protected/env values.
Web scraping form fields can use protected/env values.
REST/API headers, params, and body fields can use protected/env values.
Webhook URLs and headers can use protected/env values.
Template secret variables render to protected/env values.
Saved YAML uses the universal ProtectedValue shape.
Runtime code resolves protected values before outbound use.
Config-returning API endpoints mask protected values.
Editing a config preserves existing encrypted values unless replaced.
Sensitive-looking plain fields produce warnings.
Required secret fields cannot be saved plain.
Community catalog validation rejects instance-specific encrypted values.
```

# Recommended first cut

Build the first version in this order:

```text
1. ProtectedValue model and utility
2. Header/cookie support
3. Web scraping form field support
4. REST/API header/param/body support
5. API masking and edit preservation
6. GUI shared components
7. Template import integration
8. Catalog validation integration
```

This gives Mkfd a consistent privacy/security foundation without trying to solve every future feed type at once.