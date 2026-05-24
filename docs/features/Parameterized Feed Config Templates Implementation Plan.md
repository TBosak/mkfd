## Goal

Add a template syntax for imported Mkfd feed configs so catalog configs and manually imported configs can ask users for values before saving.

This should support:

```text
Catalog config
  -> declares variables
  -> Mkfd generates an import form
  -> user fills values
  -> Mkfd renders config
  -> secrets are encrypted or stored as env references
  -> Mkfd saves a normal FeedConfig YAML
```

The key design rule:

> Templates are resolved at import time. Workers should only process normal resolved FeedConfig files.

This keeps feed generation simple and avoids resolving templates during every feed refresh.

---

# 1. Final user experience

## Catalog import

A catalog recipe might say:

```text
GitHub Repository Releases
Requires setup
Requires optional secret
```

When the user clicks **Import**, Mkfd opens a dynamic form:

```text
Repository owner:    [TBosak       ]
Repository name:     [mkfd         ]
GitHub token:        [************ ] optional
Secret storage:      [Encrypt in config | Use environment variable]
```

After saving, Mkfd writes a normal local config:

```yaml
schemaVersion: 2
feedId: generated-id
feedName: github-releases-tbosak-mkfd
feedType: rest
config:
  baseUrl: https://api.github.com
  route: /repos/TBosak/mkfd/releases
  apiSpecificHeaders:
    Accept: application/vnd.github+json
    Authorization:
      type: protected
      value: ENC:v1:aes-256-gcm:...
```

## Manual import

Manual YAML import should support the same flow:

```text
Paste/upload YAML
  -> Mkfd detects template.variables
  -> user fills generated form
  -> Mkfd saves resolved FeedConfig
```

---

# 2. Template YAML shape

Add an optional `template` block to catalog or imported YAML.

```yaml
schemaVersion: 2
catalogVersion: 1
feedName: github-releases
feedType: rest
refreshTime: 30

metadata:
  title: GitHub Repository Releases
  description: Creates a feed from GitHub releases for a selected repository.
  category: developer
  tags:
    - github
    - releases
  catalogReady: true

template:
  variables:
    owner:
      label: Repository owner
      type: string
      required: true
      placeholder: TBosak

    repo:
      label: Repository name
      type: string
      required: true
      placeholder: mkfd

    token:
      label: GitHub token
      description: Optional. Increases rate limits and supports private repositories.
      type: secret
      required: false
      encrypted: true

config:
  baseUrl: https://api.github.com
  method: GET
  route: /repos/{{ owner }}/{{ repo }}/releases
  apiSpecificHeaders:
    Accept: application/vnd.github+json
    Authorization: "{{ secret.token | bearer }}"

apiMapping:
  items: $
  title: name
  link: html_url
  description: body
  date: published_at
  author: author.login
  guid: id
```

---

# 3. Supported placeholder syntax

Use a small Mustache-like syntax:

```text
{{ owner }}
{{ repo }}
{{ searchTerm | urlEncode }}
{{ category | slug }}
{{ secret.token }}
{{ secret.token | bearer }}
```

Supported filters for MVP:

```text
trim
lower
upper
slug
urlEncode
bearer
```

Examples:

```yaml
route: /repos/{{ owner }}/{{ repo }}/releases
baseUrl: https://example.com/search?q={{ searchTerm | urlEncode }}
Authorization: "{{ secret.token | bearer }}"
```

Do not support arbitrary expressions:

```text
No eval
No JavaScript
No fetch
No process.env access inside templates
No loops
No conditionals in MVP
```

---

# 4. Add template model

Create:

```text
models/feed-template.model.ts
```

```ts
export type FeedConfigTemplate = {
  variables: Record<string, FeedConfigTemplateVariable>;
};

export type FeedConfigTemplateVariable = {
  label: string;
  description?: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "url"
    | "select"
    | "multiselect"
    | "secret"
    | "textarea"
    | "json";
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  encrypted?: boolean;
  validation?: FeedConfigTemplateVariableValidation;
  options?: Array<{
    label: string;
    value: string;
  }>;
};

export type FeedConfigTemplateVariableValidation = {
  pattern?: string;
  min?: number;
  max?: number;
  allowedHosts?: string[];
  disallowedHosts?: string[];
};

export type FeedConfigTemplateValues = Record<string, unknown>;

export type FeedConfigTemplateSecretStorage = Record<
  string,
  "protected" | "env" | "plain"
>;

export type RenderFeedConfigTemplateOptions = {
  feedId: string;
  encryptionKey: string;
  values: FeedConfigTemplateValues;
  secretStorage?: FeedConfigTemplateSecretStorage;
  origin?: {
    type: "community" | "manual";
    catalogId?: string;
  };
};
```

For catalog configs, `plain` should not be allowed for secret variables. For local manual imports, you can still warn strongly if a secret is stored plain.

---

# 5. Extend ProtectedValue

Current proposed model:

```ts
export type ProtectedValue =
  | {
      type: "protected";
      value: string;
    }
  | {
      type: "env";
      value: string;
    };
```

Extend it slightly so env values can support common header prefixes:

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
```

This lets templates render:

```yaml
Authorization:
  type: env
  value: GITHUB_TOKEN
  prefix: "Bearer "
```

At runtime, resolving this produces:

```text
Bearer ${process.env.GITHUB_TOKEN}
```

Update protected value resolution:

```ts
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
```

---

# 6. Add template utility

Create:

```text
utilities/feed-template.utility.ts
```

Core functions:

```ts
export function hasFeedTemplate(input: unknown): boolean;

export function extractFeedTemplate(input: unknown): FeedConfigTemplate | undefined;

export function findTemplateExpressions(input: unknown): TemplateExpression[];

export function validateFeedTemplate(
  input: unknown,
): FeedTemplateValidationResult;

export function validateTemplateValues(
  template: FeedConfigTemplate,
  values: Record<string, unknown>,
): FeedTemplateValidationResult;

export function renderFeedConfigTemplate(
  input: Record<string, unknown>,
  options: RenderFeedConfigTemplateOptions,
): Record<string, unknown>;

export function findUnresolvedTemplateExpressions(input: unknown): TemplateExpression[];
```

Types:

```ts
export type TemplateExpression = {
  path: string;
  raw: string;
  namespace?: "value" | "secret";
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

---

# 7. Template parsing behavior

Supported expression format:

```text
{{ variableName }}
{{ variableName | filter }}
{{ variableName | filterA | filterB }}
{{ secret.variableName }}
{{ secret.variableName | bearer }}
```

Parser rules:

```text
Trim whitespace inside braces.
Variable names must match declared template variables.
secret.variableName can only reference variables with type: secret.
Normal placeholders cannot reference secret variables.
Filters must be from the allowlist.
```

Expression examples:

```ts
parseTemplateExpression("{{ owner }}")
```

Returns:

```ts
{
  namespace: "value",
  variableName: "owner",
  filters: []
}
```

```ts
parseTemplateExpression("{{ secret.token | bearer }}")
```

Returns:

```ts
{
  namespace: "secret",
  variableName: "token",
  filters: ["bearer"]
}
```

---

# 8. Rendering behavior

The renderer should recursively walk the config object.

It should render placeholders in:

```text
strings
arrays
objects
headers
routes
URLs
GraphQL variables
metadata
feedName
selector baseUrl values
```

It should remove these fields before saving:

```text
template
catalogVersion
metadata.catalogReady
```

It should add or override:

```text
feedId
schemaVersion: 2
metadata.origin
```

Pseudo-flow:

```ts
export function renderFeedConfigTemplate(
  input: Record<string, unknown>,
  options: RenderFeedConfigTemplateOptions,
): Record<string, unknown> {
  const template = extractFeedTemplate(input);

  if (!template) {
    return input;
  }

  const templateValidation = validateFeedTemplate(input);
  if (!templateValidation.valid) {
    throw new Error("Invalid feed template.");
  }

  const valuesValidation = validateTemplateValues(template, options.values);
  if (!valuesValidation.valid) {
    throw new Error("Invalid template values.");
  }

  const cloned = structuredClone(input);
  delete cloned.template;
  delete cloned.catalogVersion;

  const rendered = renderValue(cloned, {
    template,
    values: options.values,
    secretStorage: options.secretStorage ?? {},
    encryptionKey: options.encryptionKey,
  });

  rendered.feedId = options.feedId;
  rendered.schemaVersion = 2;
  rendered.metadata = {
    ...(isObject(rendered.metadata) ? rendered.metadata : {}),
    origin: options.origin,
  };

  const unresolved = findUnresolvedTemplateExpressions(rendered);
  if (unresolved.length > 0) {
    throw new Error("Rendered config still contains unresolved template expressions.");
  }

  return pruneEmptyValues(rendered);
}
```

---

# 9. Secret rendering behavior

## Protected mode

Template:

```yaml
Authorization: "{{ secret.token | bearer }}"
```

Input:

```json
{
  "values": {
    "token": "ghp_example"
  },
  "secretStorage": {
    "token": "protected"
  }
}
```

Saved output:

```yaml
Authorization:
  type: protected
  value: ENC:v1:aes-256-gcm:...
```

Encrypted plaintext:

```text
Bearer ghp_example
```

## Env mode

Input:

```json
{
  "values": {
    "token": "GITHUB_TOKEN"
  },
  "secretStorage": {
    "token": "env"
  }
}
```

Saved output:

```yaml
Authorization:
  type: env
  value: GITHUB_TOKEN
  prefix: "Bearer "
```

## Empty optional secret

If a secret is not required and the user leaves it blank, remove the rendered field.

Template:

```yaml
apiSpecificHeaders:
  Accept: application/vnd.github+json
  Authorization: "{{ secret.token | bearer }}"
```

If `token` is empty, save:

```yaml
apiSpecificHeaders:
  Accept: application/vnd.github+json
```

This avoids broken empty Authorization headers.

---

# 10. Filter behavior

Implement these filters:

```ts
export function applyTemplateFilters(value: string, filters: string[]) {
  return filters.reduce((current, filter) => {
    if (filter === "trim") return current.trim();
    if (filter === "lower") return current.toLowerCase();
    if (filter === "upper") return current.toUpperCase();
    if (filter === "slug") return slugify(current);
    if (filter === "urlEncode") return encodeURIComponent(current);
    if (filter === "bearer") return `Bearer ${current}`;
    throw new Error(`Unsupported template filter: ${filter}`);
  }, value);
}
```

For env-backed secrets with `bearer`, do not transform the env var name. Store the prefix:

```ts
if (storage === "env" && filters.includes("bearer")) {
  return {
    type: "env",
    value: envVarName,
    prefix: "Bearer ",
  };
}
```

---

# 11. Validation rules

## Template schema validation

Validate:

```text
template.variables exists and is an object.
Every variable has a label.
Every variable has a supported type.
select/multiselect variables have options.
secret variables cannot have unsafe default values.
validation.pattern is a valid regex.
```

## Placeholder validation

Validate:

```text
Every placeholder references a declared variable.
secret.foo references a variable with type: secret.
Non-secret placeholder cannot reference a secret variable.
Every filter is supported.
No placeholders are used in unsupported locations.
```

## Value validation

Validate:

```text
Required variables are provided.
number values are numeric.
boolean values are boolean or parseable.
url values are valid URLs.
select values are in the options list.
multiselect values are in the options list.
json values parse.
pattern validation passes.
min/max validation passes.
```

## Rendered config validation

After rendering:

```text
No unresolved placeholders remain.
Final object validates as FeedConfig.
No plaintext secret remains in sensitive headers.
Catalog imports do not save catalogVersion.
Saved config includes generated feedId.
```

---

# 12. Catalog manifest support

Extend manifest entries with template metadata:

```ts
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
```

Example:

```json
{
  "id": "github-releases",
  "title": "GitHub Repository Releases",
  "description": "Creates a feed from GitHub releases for a selected repository.",
  "category": "developer",
  "tags": ["github", "releases"],
  "feedType": "rest",
  "path": "feeds/developer/github-releases.yaml",
  "sourceHomepage": "https://github.com",
  "requiresSecrets": true,
  "requiresPrivateNetwork": false,
  "requiresTemplateValues": true,
  "templateVariables": ["owner", "repo", "token"],
  "schemaVersion": 2,
  "catalogVersion": 1
}
```

Catalog UI badges:

```text
Template
Requires setup
Optional secret
Requires secret
```

---

# 13. Backend import endpoint changes

Update:

```text
POST /community-catalog/import/:id
```

New payload:

```ts
export type ImportCatalogFeedRequest = {
  values?: Record<string, unknown>;
  secretStorage?: Record<string, "protected" | "env" | "plain">;
  feedName?: string;
};
```

Flow:

```text
Fetch catalog YAML.
Parse YAML.
If template exists:
  validate template.
  validate submitted values.
  render template.
Else:
  use config as-is.
Assign feedId.
Normalize to FeedConfig.
Validate FeedConfig.
Write YAML to /app/configs.
Start feed updater.
Return feedId and URLs.
```

Pseudo-route:

```ts
app.post("/community-catalog/import/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const body = await ctx.req.json();
  const catalogYaml = await getCatalogFeedYaml(id);
  const parsed = yaml.load(catalogYaml.yaml) as Record<string, unknown>;

  const feedId = crypto.randomUUID();

  const rendered = hasFeedTemplate(parsed)
    ? renderFeedConfigTemplate(parsed, {
        feedId,
        encryptionKey,
        values: body.values ?? {},
        secretStorage: body.secretStorage ?? {},
        origin: {
          type: "community",
          catalogId: id,
        },
      })
    : {
        ...parsed,
        feedId,
        schemaVersion: 2,
      };

  if (body.feedName) {
    rendered.feedName = body.feedName;
  }

  const feedConfig = normalizeLoadedFeedConfig(rendered);
  const validation = validateFeedConfig(feedConfig);

  if (!validation.valid) {
    return ctx.json(validation, 400);
  }

  await writeFile(
    join(configsDir, `${feedConfig.feedId}.yaml`),
    yaml.dump(feedConfig),
    "utf8",
  );

  setFeedUpdaterInterval(feedConfig);

  return ctx.json({
    ok: true,
    feedId: feedConfig.feedId,
    feedName: feedConfig.feedName,
    feedUrl: `/public/feeds/${feedConfig.feedId}.xml`,
  });
});
```

---

# 14. Add template preview endpoint

Add:

```text
POST /community-catalog/preview-template/:id
```

Payload:

```ts
export type PreviewCatalogTemplateRequest = {
  values: Record<string, unknown>;
  secretStorage?: Record<string, "protected" | "env" | "plain">;
};
```

Response:

```ts
export type PreviewCatalogTemplateResponse = {
  valid: boolean;
  renderedYaml?: string;
  errors: FeedTemplateValidationIssue[];
  warnings: FeedTemplateValidationIssue[];
};
```

Important: mask protected values in preview.

Example preview output:

```yaml
apiSpecificHeaders:
  Accept: application/vnd.github+json
  Authorization:
    type: protected
    value: "********"
```

Do not return encrypted ciphertext in preview unless the user is actually saving.

---

# 15. Manual import changes

Update manual import flow:

```text
Upload YAML / paste YAML
  -> parse
  -> if template.variables exists
       show dynamic template form
     else
       show normal import confirmation
  -> render and save
```

Add endpoint:

```text
POST /configs/import-template-preview
POST /configs/import-template
```

Or reuse existing import endpoint with template detection.

Manual import should support private URLs because it is local. Public catalog validation can be stricter.

---

# 16. Frontend components

Add:

```text
TemplateImportDialog.tsx
TemplateVariableField.tsx
SecretTemplateVariableField.tsx
TemplateRenderedPreview.tsx
```

## `TemplateImportDialog`

Responsibilities:

```text
Read template variables.
Initialize default values.
Render dynamic form.
Track validation errors.
Submit values to backend.
Show rendered preview.
Save/import config.
```

## `TemplateVariableField`

Map variable types:

```text
string       -> text input
number       -> number input
boolean      -> checkbox
url          -> URL input
select       -> select dropdown
multiselect  -> multi-select
secret       -> password input
textarea     -> textarea
json         -> JSON textarea
```

## `SecretTemplateVariableField`

For secret fields, show:

```text
Value input
Storage method:
  Encrypt and store in config
  Reference environment variable
```

If env mode is selected, the field label changes:

```text
Environment variable name
```

Example:

```text
GITHUB_TOKEN
```

Default secret storage:

```text
protected
```

---

# 17. Catalog import UI flow

```text
User clicks Import on catalog recipe.
Mkfd fetches YAML.
If template exists:
  Open TemplateImportDialog.
Else:
  Open normal import dialog.

Template dialog:
  1. Setup fields
  2. Optional rendered YAML preview
  3. Import feed
```

For manifest badges:

```text
Template
Requires setup
Requires secret
```

For optional secret:

```text
Optional secret
```

---

# 18. Catalog sanitizer integration

Later, when users submit configs to the community catalog, add an advanced option:

```text
Convert values into template variables
```

Examples:

```text
Make baseUrl configurable
Make route parameter configurable
Make Authorization header a secret input
Make search query configurable
```

This is a later enhancement, not MVP.

For MVP, catalog templates can be handwritten.

---

# 19. Catalog CI updates

Update:

```text
scripts/validate-community-catalog.ts
```

Add checks:

```text
template.variables is valid.
Every placeholder references declared variable.
Every secret placeholder references a secret variable.
No secret default values.
No unresolved placeholders outside allowed template syntax.
No hard-coded Authorization/Cookie/X-Api-Key secrets.
Catalog config may contain placeholders.
Catalog config must render successfully if all required variables have defaults.
Manifest requiresTemplateValues matches template presence.
Manifest templateVariables matches declared template variables.
```

Catalog configs should be allowed to contain:

```yaml
Authorization: "{{ secret.token | bearer }}"
```

But not:

```yaml
Authorization: Bearer ghp_actualToken
```

---

# 20. Security rules

```text
Never save plaintext secret variables from catalog import.
Never include secret values in frontend preview responses.
Never log submitted template values.
Never allow arbitrary template expressions.
Never allow templates to access process.env directly.
Never allow templates to fetch URLs or execute code.
Reject unknown filters.
Reject undeclared variables.
Reject unresolved placeholders after rendering.
```

For manual imports, warn if the user chooses plain secret storage:

```text
Plain secret storage is not recommended. The value will be written directly into the YAML config.
```

For catalog imports, disable plain secret storage by default.

---

# 21. Test plan

## Template parser tests

```text
Parses {{ owner }}.
Parses {{ owner | slug }}.
Parses {{ secret.token }}.
Parses {{ secret.token | bearer }}.
Rejects unknown filters.
Rejects malformed expressions.
```

## Template validation tests

```text
Rejects undeclared placeholders.
Rejects secret placeholder for non-secret variable.
Rejects normal placeholder for secret variable.
Rejects select variable without options.
Rejects invalid regex pattern.
Rejects missing required value.
Rejects invalid URL value.
```

## Rendering tests

```text
Renders strings.
Renders nested objects.
Renders arrays.
Renders route paths.
Renders GraphQL variables.
Renders headers.
Removes empty optional secret fields.
Removes template block.
Adds feedId.
Adds metadata.origin.
Rejects unresolved placeholders.
```

## Secret tests

```text
Protected secret is encrypted.
Bearer protected secret encrypts transformed value.
Env secret stores env var name.
Bearer env secret stores prefix.
Secret preview is masked.
Plain secret is rejected for catalog import.
```

## Import tests

```text
Catalog config without template imports normally.
Catalog config with template requires values.
Catalog template renders then saves normal FeedConfig.
Manual imported template renders and saves.
Final saved config validates.
Final saved config contains no template block.
```

## CI tests

```text
Catalog template passes validation.
Catalog hard-coded Authorization token fails validation.
Catalog undeclared placeholder fails validation.
Manifest template variables match YAML.
```

---

# 22. Implementation phases

## Phase 1: Model and syntax

```text
Add feed-template.model.ts.
Define template.variables.
Define supported field types.
Define placeholder syntax.
Extend ProtectedValue with prefix/suffix for env mode.
```

## Phase 2: Template utility

```text
Add feed-template.utility.ts.
Implement expression parser.
Implement variable validation.
Implement value validation.
Implement recursive renderer.
Implement unresolved placeholder detection.
```

## Phase 3: Backend catalog import

```text
Update /community-catalog/import/:id.
Render template before normalization.
Encrypt protected secret values.
Save resolved FeedConfig.
Add template preview endpoint.
```

## Phase 4: Frontend dynamic import form

```text
Add TemplateImportDialog.
Add TemplateVariableField.
Add SecretTemplateVariableField.
Wire into catalog import flow.
Show setup-required and secret badges.
```

## Phase 5: Manual import support

```text
Detect template.variables in pasted/uploaded YAML.
Render dynamic form.
Save resolved FeedConfig.
```

## Phase 6: Catalog validation and CI

```text
Update validate-community-catalog script.
Allow declared placeholders.
Reject undeclared placeholders and secrets.
Validate manifest template metadata.
```

## Phase 7: Authoring tools

```text
Add docs for writing catalog templates.
Add example GitHub releases template.
Add example search URL template.
Add optional template preview in catalog development tooling.
```

---

# 23. README to-do item

Add this under remote catalog/community features:

```md
- [ ] Parameterized feed config templates
  - Allow catalog and manually imported YAML configs to declare `template.variables`.
  - Generate a dynamic import form from template variables.
  - Support placeholders like `{{ owner }}`, `{{ repo | urlEncode }}`, and `{{ secret.token | bearer }}`.
  - Encrypt secret values or reference environment variables before saving.
  - Resolve templates at import time and save normal FeedConfig YAML files.
  - Validate templates in the community catalog CI.
```

---

# 24. Acceptance criteria

This feature is done when:

```text
Catalog YAML can declare template.variables.
Mkfd detects templates during catalog import.
Mkfd generates a dynamic form from template variables.
Users can provide string, number, boolean, url, select, textarea, json, and secret values.
Secret values can be encrypted into the saved config.
Secret values can be stored as env references.
Templates render into normal FeedConfig YAML.
Saved configs do not contain the template block.
Saved configs do not contain plaintext catalog secrets.
Final rendered configs validate before saving.
Manual YAML import supports templates too.
Catalog CI validates template declarations and placeholder usage.
```

# MVP scope

Build the first version with:

```text
template.variables
{{ variableName }}
{{ variableName | urlEncode }}
{{ variableName | slug }}
{{ secret.variableName }}
{{ secret.variableName | bearer }}
string
number
boolean
url
select
secret
protected/env secret storage
catalog import support
manual import support
```

Skip until later:

```text
conditionals
loops
complex expressions
runtime template rendering
computed defaults
full JSON schema
template authoring GUI
automatic conversion of configs into templates
```

# Final recommendation

This is a strong path for Mkfd.

It turns the community catalog from a list of static examples into a library of reusable recipes:

```text
GitHub releases for any repo
Search pages for any query
REST APIs with user-provided API keys
GraphQL queries with user-provided variables
Configurable web scraping feeds
```

The safest and cleanest implementation is:

> Render templates once during import, encrypt or reference secrets immediately, then save a normal resolved FeedConfig.