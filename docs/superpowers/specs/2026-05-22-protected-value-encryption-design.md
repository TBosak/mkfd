# Protected Value Encryption — Design Spec

**Date:** 2026-05-22
**Tier:** R1 Foundation
**Status:** Approved

---

## Goal

Allow any user-specific config value that could be considered sensitive — headers, cookies, URLs, API params, body fields, form fields — to be stored as AES-encrypted ciphertext or as a reference to an environment variable, rather than as a plain string. Generalises the existing `security.utility.ts` encrypt/decrypt without replacing it.

---

## Scope

### In scope

- `ProtectedValue` model and narrow field types
- Backend utility layer: protect, resolve, mask, preserve
- Sensitive config scanner (warnings only, non-blocking)
- Backend resolution wired into web scraping and API/REST workers immediately before outbound HTTP calls
- Masking on all config-returning API endpoints
- Preserve-on-save round-trip (masked `"********"` restores original ciphertext)
- Email `encryptedPassword` → `ProtectedValue` migration on re-save; runtime backward compat
- Three shared GUI components with per-row storage mode selectors
- Inline sensitive value warnings at save time

### Out of scope (deferred to later specs)

- Catalog submission guards → Community Catalog spec
- Service connector auth enforcement → Service Connectors spec
- Template secret variable rendering → Parameterized Templates spec
- CSS selector targets (`article.*`, `CSSTargetFields`) — these are never protected values
- Feed-level RSS metadata fields
- Structural config fields (`refreshTime`, `enabled`, `reverse`, etc.)

---

## Data Model

### `models/protected-value.model.ts`

```ts
export type ProtectedValue =
  | { type: "protected"; value: string }
  | { type: "env"; value: string; prefix?: string };

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ProtectedValue
  | ConfigValue[]
  | { [key: string]: ConfigValue };

export type ProtectedRecord = Record<string, string | ProtectedValue>;

export type HeaderValue = string | ProtectedValue;

export type WebScrapingFormFieldValue =
  | string
  | number
  | boolean
  | ProtectedValue
  | Array<string | number | boolean | ProtectedValue>;
```

`FeedCookie.value` is updated to `string | ProtectedValue`. All other `FeedCookie` fields remain plain.

### Fields that accept ProtectedValue

| Location | Fields |
|---|---|
| Any feed type | `headers` (`ProtectedRecord`) |
| Any feed type | `cookies[*].value` |
| Web scraping source config | `baseUrl` |
| Web scraping form submission | `actionUrl`, `fields` values |
| REST / API source config | `baseUrl`, `params`, `apiSpecificHeaders`, `apiSpecificBody` field values |
| GraphQL config | `endpoint`, `headers`, `variables` values |
| Webhook config | `url`, `headers` |
| Service connector | `connection.auth.fields` (required protected/env — no plain) |
| Email | `config.password` (`ProtectedValue`) |

### Fields that do NOT accept ProtectedValue

- `article.*` (all CSS selector targets in `CSSTargetFields`)
- `apiMapping.*` (field path strings)
- Feed-level RSS metadata (`feedTitle`, `feedDescription`, etc.)
- Structural fields (`feedId`, `feedName`, `refreshTime`, `enabled`, etc.)

---

## Backend Utility Layer

### `utilities/protected-values.utility.ts`

Wraps `encrypt`/`decrypt` from the existing `security.utility.ts`. No changes to `security.utility.ts`.

| Export | Behaviour |
|---|---|
| `isProtectedValue(v)` | Type guard — true for `{ type: "protected" }` or `{ type: "env" }` |
| `protectValue(plaintext, key)` | Returns `{ type: "protected", value: encrypt(plaintext, key) }` |
| `envValue(varName, prefix?)` | Returns `{ type: "env", value: varName, prefix }` |
| `resolveProtectedValue(pv, key)` | Decrypts protected or resolves env. Throws `"Missing environment variable: VAR_NAME"` if env var absent |
| `resolveProtectedValues(input, {key})` | Recursively resolves all `ProtectedValue` instances inside any object or array. Plain values pass through unchanged |
| `maskProtectedValues(input)` | Recursively replaces `value` with `"********"` inside any `ProtectedValue`. Used before API responses |
| `preserveMaskedProtectedValues(incoming, existing)` | Recursively restores original `ProtectedValue` wherever `incoming` has `value: "********"`. Used in the save path |

### `utilities/sensitive-config.utility.ts`

| Export | Behaviour |
|---|---|
| `isSensitiveConfigPath(path)` | Returns true if the path contains any of: `authorization`, `cookie`, `x-api-key`, `apikey`, `apitoken`, `token`, `secret`, `password`, `passwd`, `session`, `csrf`, `access_token`, `refresh_token`, `bearer` |
| `findPlainSensitiveValues(input)` | Walks an object tree; returns `{ path, message }[]` for plain string/number/boolean values found at sensitive-looking paths. Returns empty array for already-protected values |

---

## API Masking and Edit Preservation

### Masking on read

`maskProtectedValues` is applied before returning config data from:
- `GET /feeds`
- `GET /feeds/:id`
- Feed save/update success response (the echoed `config` field)
- Preview response if it echoes config

The frontend always receives `"********"` — never ciphertext, never a resolved secret.

### Preservation on write (save path)

When a save request arrives, the backend:
1. Reads the existing config from disk
2. Calls `preserveMaskedProtectedValues(incoming, existing)` — restores original ciphertext for any field still carrying `"********"`
3. For fields the user actually changed (new plaintext typed, new env reference entered), encrypts or stores as appropriate
4. Writes the resulting config to YAML

### Email migration

On save of an email config:
- If `config.encryptedPassword` is present and the user has not supplied a new password value, it is rewritten as `config.password: { type: "protected", value: <same ciphertext> }` and `encryptedPassword` is removed from the saved YAML
- Workers check `config.password` first; fall back to `config.encryptedPassword` for backward compatibility with existing deployed instances

### Runtime resolution

`resolveProtectedValues` is called in workers **immediately before** outbound HTTP calls — not at config load time. This minimises the window in which resolved secrets are in memory and avoids accidental logging.

Locations:
- Web scraping worker: resolve `headers`, `cookies[*].value`, `config.baseUrl` before fetch
- API/REST worker: resolve `headers`, `config.apiSpecificHeaders`, `config.params`, `config.apiSpecificBody` before fetch

---

## GUI Components

All components live in `frontend/src/components/protected-value/`.

### `ProtectedValueInput`

For single-value fields (`baseUrl`, webhook URL, etc.).

- Renders a text input and a storage mode selector: **Plain / Encrypted / Env var**
- For existing encrypted fields: shows `"********"`. Value is only updated if the user types in the field (field is "sticky" by default)
- For env var mode: shows variable name input and optional prefix field
- New fields default to Plain mode

### `ProtectedKeyValueEditor`

For headers, API params, GraphQL variables, web scraping form fields.

Table of rows. Each row has:
- Key input
- Value input (with sticky `"********"` behaviour for existing protected values)
- Storage mode selector: Plain / Encrypted / Env var (per row)

Every row gets a storage mode selector regardless of key name.

### `ProtectedCookieEditor`

Same as `ProtectedKeyValueEditor` plus cookie-specific columns: domain, path, secure, httpOnly.

### Integration points (this spec)

These components replace existing plain string editors in:
- Web scraping form: headers and cookies sections
- API/REST form: headers and params sections

The existing form structure is preserved — only the editor widgets change.

`ProtectedKeyValueEditor` and `ProtectedValueInput` are also the components that later specs will use for form submission fields (Web Scraping Form Data spec), GraphQL variables (GraphQL spec), and webhook headers (Webhook spec). The components are built here; the wiring into those forms happens in their own specs.

### Sensitive value warning

After a save attempt, `findPlainSensitiveValues` runs against the submitted config. Any finding produces a non-blocking inline warning beneath the relevant field:

> *"This value looks sensitive. Consider encrypting it."*

Save proceeds regardless. The warning is informational only.

---

## Validation

### Save-time (non-blocking)

`findPlainSensitiveValues` runs on the config before YAML write. Findings appear as warnings in the UI. Does not block save.

### Runtime (blocking, worker)

`resolveProtectedValues` throws if a `{ type: "env" }` reference points to a missing environment variable. The feed run fails with message: *"Missing environment variable: VAR_NAME"*. This surfaces in the run log like any other feed error.

---

## What This Spec Does Not Cover

- Auto-encrypting plain sensitive values — Mkfd warns, never auto-converts
- Community catalog ciphertext guards — deferred to Community Catalog spec
- Service connector auth plain-value enforcement — deferred to Service Connectors spec
- Template `{{ secret.token }}` resolution — deferred to Parameterized Templates spec
- `suffix` on env references — dropped (YAGNI)
- ProtectedValue on any CSS selector target fields — never in scope
