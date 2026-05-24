# Parameterized Feed Config Templates — Design Spec

**Date:** 2026-05-24
**Tier:** R4 Catalog & Import
**Status:** Approved

---

## Goal

Add a template syntax for Mkfd feed configs so catalog entries and manually imported configs can ask users for values before saving. Templates are resolved once at import time. Workers only ever process normal resolved `FeedConfig` YAML.

---

## Scope

### In scope

- `template.variables` block in catalog/imported YAML
- Placeholder syntax: `{{ owner }}`, `{{ owner | slug }}`, `{{ secret.token }}`, `{{ secret.token | bearer }}`
- Filters: `trim`, `lower`, `upper`, `slug`, `urlEncode`, `bearer`
- Variable types: `string`, `number`, `boolean`, `url`, `select`, `textarea`, `secret`
- Secret storage modes: `protected` (encrypted at rest), `env` (env variable reference with optional `prefix`/`suffix`)
- Recursive renderer (walks strings, arrays, objects)
- Template block stripped from saved config
- `feedId`, `schemaVersion: 2`, `metadata.origin` added to rendered config
- Dynamic import form UI for both catalog and manual import paths
- Template preview endpoint (masked values)
- Catalog CI validation for template declarations

### Out of scope

- `multiselect` and `json` variable types (deferred to a later iteration)
- `plain` secret storage for catalog imports (blocked; allowed with a strong warning for manual imports)
- Runtime template rendering during worker execution
- Conditionals, loops, computed defaults, `process.env` access inside templates
- Template authoring GUI or automatic config-to-template conversion

---

## Dependencies

Must be implemented first:

- Community Catalog (provides `POST /community-catalog/import/:id` and catalog client)
- Feed Config Formalization
- Protected Value Encryption

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| Template model | `models/feed-template.model.ts` | All template and variable types |
| Template utility | `utilities/feed-template.utility.ts` | Parser, validator, renderer, filter engine |
| Tests | `tests/feed-template.test.ts` | Unit tests |
| Catalog import route | `routes/catalog.ts` | Update `POST /community-catalog/import/:id`, add `POST /community-catalog/preview-template/:id` |
| Manual import route | `routes/configs.ts` | Detect template on paste/upload, render before save |
| Catalog CI script | `scripts/validate-community-catalog.ts` | Validate template declarations and placeholder usage |
| Frontend dialog | `frontend/src/components/catalog/TemplateImportDialog.tsx` | Renders dynamic form from template variables |
| Frontend field | `frontend/src/components/catalog/TemplateVariableField.tsx` | Single variable input mapped by type |
| Frontend secret | `frontend/src/components/catalog/SecretTemplateVariableField.tsx` | Secret input + storage method selector |

---

## Config Model

### `models/feed-template.model.ts` (new)

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

### ProtectedValue extension

`models/protected-value.model.ts` gains `prefix` and `suffix` on the env variant to support bearer filter rendering:

```ts
export type ProtectedValue =
  | { type: "protected"; value: string }
  | { type: "env"; value: string; prefix?: string; suffix?: string };
```

Runtime resolution:

```ts
export function resolveProtectedValue(value: ProtectedValue, encryptionKey: string): string {
  if (value.type === "env") {
    const raw = process.env[value.value];
    if (!raw) throw new Error(`Missing environment variable: ${value.value}`);
    return `${value.prefix ?? ""}${raw}${value.suffix ?? ""}`;
  }
  return decrypt(value.value, encryptionKey);
}
```

---

## Template Utility

### `utilities/feed-template.utility.ts` (new)

```ts
export function hasFeedTemplate(input: unknown): boolean;

export function extractFeedTemplate(input: unknown): FeedConfigTemplate | undefined;

export function findTemplateExpressions(input: unknown): TemplateExpression[];

export function validateFeedTemplate(input: unknown): FeedTemplateValidationResult;

export function validateTemplateValues(
  template: FeedConfigTemplate,
  values: Record<string, unknown>,
  secretStorage?: FeedConfigTemplateSecretStorage,
): FeedTemplateValidationResult;

export function renderFeedConfigTemplate(
  input: Record<string, unknown>,
  options: RenderFeedConfigTemplateOptions,
): Record<string, unknown>;

export function findUnresolvedTemplateExpressions(input: unknown): TemplateExpression[];

export function applyTemplateFilters(value: string, filters: string[]): string;
```

### Expression parser rules

- Trim whitespace inside `{{ }}`.
- `{{ variableName }}` → namespace `"value"`, variableName = `variableName`, filters = `[]`
- `{{ variableName | filter1 | filter2 }}` → filters = `["filter1", "filter2"]`
- `{{ secret.variableName }}` → namespace `"secret"`, variableName = `variableName`
- `secret.*` placeholders may only reference variables with `type: "secret"`.
- Non-secret placeholders may not reference `type: "secret"` variables.
- Unknown filters → hard validation error.
- Unknown variable names → hard validation error.

### Rendering flow

1. Clone input; delete `template`, `catalogVersion` from the clone.
2. Walk all string values recursively; replace `{{ ... }}` expressions.
3. For `namespace: "value"`: substitute rendered string value with filters applied.
4. For `namespace: "secret"`:
   - `storage: "protected"`: encrypt the bearer/filter-applied value → store `ProtectedValue { type: "protected", value: encrypted }`.
   - `storage: "env"`: store `ProtectedValue { type: "env", value: envVarName, prefix: "Bearer " }` (if bearer filter used).
   - `storage: "plain"` (manual import only, strong warning): store plaintext. **Not allowed for catalog imports.**
5. Empty optional secret fields → remove the field from the output entirely (avoids broken empty headers).
6. Assign `feedId`, `schemaVersion: 2`, `metadata.origin`.
7. Assert no unresolved expressions remain → hard failure if any are found.

### Filter behavior

| Filter | Behavior |
|---|---|
| `trim` | `value.trim()` |
| `lower` | `value.toLowerCase()` |
| `upper` | `value.toUpperCase()` |
| `slug` | replace non-alphanumeric with `-`, lowercase, collapse multiple `-` |
| `urlEncode` | `encodeURIComponent(value)` |
| `bearer` | `"Bearer " + value` (for non-secret) or store as `prefix` in env ProtectedValue |

---

## Backend Routes

### Update `POST /community-catalog/import/:id`

New request body:

```ts
type ImportCatalogFeedRequest = {
  values?: Record<string, unknown>;
  secretStorage?: Record<string, "protected" | "env">;
  feedName?: string;
};
```

Flow:
1. Fetch catalog YAML.
2. If `template.variables` exists: validate template, validate submitted values, render.
3. Otherwise: use config as-is (add `feedId`, `schemaVersion: 2`).
4. Normalize → validate → reject if invalid → write to `/app/configs` → start feed updater → return `feedId`.

### Add `POST /community-catalog/preview-template/:id`

Request:
```ts
type PreviewCatalogTemplateRequest = {
  values: Record<string, unknown>;
  secretStorage?: Record<string, "protected" | "env">;
};
```

Response (masked):
```ts
type PreviewCatalogTemplateResponse = {
  valid: boolean;
  renderedYaml?: string;
  errors: FeedTemplateValidationIssue[];
  warnings: FeedTemplateValidationIssue[];
};
```

Protected values are rendered as `"********"` in preview — never return ciphertext or plaintext secrets.

### Manual import detection

On `POST /configs/import`, detect `template.variables`. If present: render before save (same flow as catalog import). Support `plain` storage with response warning but allow save. Catalog import never accepts `plain`.

---

## Frontend

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.**

### `TemplateImportDialog`

- Reads `template.variables` from catalog YAML.
- Renders `TemplateVariableField` for each variable.
- Shows "Rendered preview" (rendered YAML with secrets masked).
- Submits values to `POST /community-catalog/preview-template/:id` on change.
- Submits to `POST /community-catalog/import/:id` on save.

### `TemplateVariableField`

Maps `variable.type` to UI:

| Type | Control |
|---|---|
| `string` | Text input |
| `number` | Number input |
| `boolean` | Checkbox |
| `url` | URL input with protocol prefix hint |
| `select` | Select dropdown with `options` |
| `textarea` | Textarea |
| `secret` | `SecretTemplateVariableField` |

### `SecretTemplateVariableField`

Shows:
- Password input for the value
- Storage selector: `Encrypt and store in config` / `Reference environment variable`
- If env mode: label changes to "Environment variable name"

Default: `protected` mode.

---

## Catalog CI

### `scripts/validate-community-catalog.ts` additions

- `template.variables` must be a valid object.
- Every placeholder in the YAML body references a declared variable.
- `secret.*` placeholders only reference `type: "secret"` variables.
- Normal placeholders do not reference `type: "secret"` variables.
- All filters are from the allowlist.
- No hardcoded Authorization/Cookie/X-Api-Key values.
- Manifest `requiresTemplateValues` matches presence of `template.variables`.
- Manifest `templateVariables` list matches declared variable names.
- Config renders successfully if all required variables have defaults.

---

## Testing

**`tests/feed-template.test.ts`**

Parser:
- Parses `{{ owner }}`
- Parses `{{ owner | slug }}`
- Parses `{{ secret.token }}`
- Parses `{{ secret.token | bearer }}`
- Rejects unknown filters
- Rejects malformed expressions

Validation:
- Rejects undeclared placeholders
- Rejects `secret.*` for non-secret variable
- Rejects normal placeholder for secret variable
- Rejects `select` without `options`
- Rejects invalid regex pattern
- Rejects missing required value
- Rejects invalid URL value

Rendering:
- Renders string substitution
- Renders nested objects
- Renders arrays
- Renders headers
- Removes empty optional secret field
- Strips `template` block from output
- Adds `feedId` and `metadata.origin`
- Hard-fails on unresolved placeholder

Secrets:
- Protected secret is encrypted
- Bearer protected secret encrypts prefixed value
- Env secret stores env var name
- Bearer env secret stores `prefix: "Bearer "`
- Preview response masks protected value as `"********"`
- Plain secret blocked for catalog import
- Plain secret allowed with warning for manual import

---

## Acceptance Criteria

- Catalog YAML can declare `template.variables`
- Mkfd detects templates during catalog and manual import
- Mkfd generates a dynamic form from template variables
- Users can provide string, number, boolean, url, select, textarea, and secret values
- Secret values are encrypted or stored as env references
- Templates render to normal `FeedConfig` YAML
- Saved configs do not contain the `template` block or plaintext catalog secrets
- Final rendered configs validate before saving
- Catalog CI rejects undeclared placeholders and hardcoded secrets

---

## Design Decisions

### 1. Which variable types in MVP?

**Options:**
- A. string, number, boolean, url, select, secret only (feature doc MVP cut)
- B. Add textarea to MVP (useful for multi-line values like GraphQL queries)
- C. Add all types including multiselect and json

**Chosen: B.** `textarea` is a simple input type with no additional parsing complexity. It's especially useful for config values that span multiple lines (GraphQL queries, descriptions). `multiselect` and `json` are deferred — `json` requires a JSON editor with validation, and `multiselect` adds serialization complexity.

---

### 2. Allow `plain` secret storage?

**Options:**
- A. Block plain storage entirely (most secure)
- B. Allow plain with warning for manual imports, block for catalog imports
- C. Allow plain everywhere with a warning

**Chosen: B.** Catalog configs are community-distributed and must never store plaintext secrets. Manual imports are a local user action and the user is responsible for their own config security; blocking it entirely would be paternalistic. A clear "plain text will be written directly to YAML" warning is sufficient for manual use.

---

### 3. Unresolved placeholders after rendering?

**Options:**
- A. Hard failure — throw error, refuse to save
- B. Soft failure — save with warning, leave unresolved expressions intact

**Chosen: A.** A config with unresolved `{{ expression }}` strings in it would break runtime in unpredictable ways (auth headers become literal strings, URLs become malformed). Hard failure with a clear error message is safer.

---

### 4. ProtectedValue env prefix/suffix vs. separate type?

**Options:**
- A. Extend existing `{ type: "env"; value: string }` with optional `prefix`/`suffix`
- B. Add a new `{ type: "envFormatted"; value: string; format: string }` variant

**Chosen: A.** The feature doc already specifies this extension, it's minimal, and adding a new variant would require updating all ProtectedValue consumers to handle a new case. The `prefix`/`suffix` pattern covers the only real use case (Bearer prefix) without overengineering.
