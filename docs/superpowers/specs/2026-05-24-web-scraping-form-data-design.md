# Web Scraping Form Data — Design Spec

**Date:** 2026-05-24
**Tier:** R3 Transformation & Scraping Intelligence
**Status:** Draft

---

## Goal

Add form submission as a first-class request mode for web scraping feeds. Instead of fetching a URL directly and scraping it, Mkfd can submit a form on that page first, then scrape the resulting page. Existing simple URL configs are unchanged.

---

## Scope

### In scope

- Static HTML form detection (GET and POST)
- `application/x-www-form-urlencoded` and `application/json` encoding; `multipart/form-data` without file uploads
- Protected form field values (encrypted at rest, resolved at fetch time)
- `POST /utils/detect-forms` endpoint
- Worker, preview, and selector suggestion all routing through the shared form-aware fetcher
- Source Assistant integration: detected form candidates passed into the Web Scraping builder on apply, with a "recommended" badge on the highest-confidence pick

### Out of scope

- Template placeholder support in form fields (deferred to Parameterized Feed Config Templates)
- Browser-driven form interaction, CAPTCHA, login automation, dynamic CSRF token refresh, multi-step forms, file uploads
- Advanced rendered-form detection (static HTML only in MVP)

---

## Architecture

Five distinct units with clear boundaries:

| Unit | File | Responsibility |
|---|---|---|
| Form detection | `utilities/form-detection.utility.ts` | Pure HTML parse + score + convert + URL-fetch wrapper |
| Web scraping fetcher | `utilities/web-scraping-fetcher.utility.ts` | Single dispatcher: simple and form paths, both through shared executor |
| Config model | `models/web-scraping-request.model.ts`, `models/html-form-detection.model.ts` | Canonical request config and detection I/O types |
| Config layer | caster, normalizer, validator utilities | Cast frontend state → config, normalize, validate |
| Detection endpoint | `routes/utils.ts` | `POST /utils/detect-forms` |

---

## Dependencies

Must be implemented first:

- Backend Route Decomposition
- Outbound Fetch Policy
- Fetch Policy / Retry / Fallback
- Protected Value Encryption
- Feed Config Formalization
- Source Assistant: Backend Core (creates base `detectForms(html, pageUrl)`)
- Builder UI Redesign (frontend components must follow its Section/Field/FieldRow patterns)

---

## Config Model

### `models/web-scraping-request.model.ts` (new)

Canonical types for the web scraping request mode. The simplified `WebScrapingFormRequestConfig` currently defined in the Source Assistant backend core model must be removed from that file and replaced with an import from this module.

```ts
import type { ProtectedValue } from "./protected-value.model";

export type WebScrapingRequestConfig =
  | WebScrapingSimpleRequestConfig
  | WebScrapingFormRequestConfig;

export type WebScrapingSimpleRequestConfig = {
  mode: "simple";
};

export type WebScrapingFormRequestConfig = {
  mode: "form";
  method: "GET" | "POST";
  actionUrl?: string;
  encoding:
    | "application/x-www-form-urlencoded"
    | "multipart/form-data"
    | "application/json";
  fields: Record<string, WebScrapingFormFieldValue>;
  submit?: WebScrapingFormSubmitOptions;
};

export type WebScrapingFormFieldValue =
  | string
  | number
  | boolean
  | ProtectedValue
  | Array<string | number | boolean | ProtectedValue>;

export type WebScrapingFormSubmitOptions = {
  followRedirects?: boolean;
  scrape?: "responseBody" | "finalResponse";
};
```

Existing `WebScrapingSourceConfig` gains `request?: WebScrapingRequestConfig`. Configs without it behave identically to today — no migration needed.

### YAML shape

```yaml
feedType: webScraping
config:
  baseUrl: https://example.com/search
  request:
    mode: form
    method: POST
    actionUrl: https://example.com/search/results
    encoding: application/x-www-form-urlencoded
    fields:
      q: city council
      sort: newest
    submit:
      followRedirects: true
      scrape: finalResponse
```

### `models/html-form-detection.model.ts` (new)

Canonical detection I/O types. These are referenced in the Source Assistant spec — this feature makes them authoritative.

```ts
import type { FeedCookie, ProtectedRecord } from "./protected-value.model";

export type DetectFormsRequest = {
  url: string;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  advanced?: boolean;
  userAgent?: string;
  timeoutMs?: number;
};

export type DetectFormsResponse = {
  url: string;
  finalUrl: string;
  forms: DetectedHtmlForm[];
  warnings: string[];
};

export type DetectedHtmlForm = {
  id: string;
  index: number;
  label: string;
  method: "GET" | "POST";
  actionUrl: string;
  encoding: "application/x-www-form-urlencoded" | "multipart/form-data";
  selector: string;
  fields: DetectedHtmlFormField[];
  confidence: number;
  confidenceBand: "high" | "medium" | "low";
  warnings: string[];
};

export type DetectedHtmlFormField = {
  name: string;
  type:
    | "text" | "search" | "hidden" | "password" | "email" | "number"
    | "checkbox" | "radio" | "select" | "textarea"
    | "submit" | "button" | "unknown";
  label?: string;
  value?: string;
  required?: boolean;
  placeholder?: string;
  options?: DetectedHtmlFormFieldOption[];
  checked?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  sensitive?: boolean;
  dynamic?: boolean;
};

export type DetectedHtmlFormFieldOption = {
  label: string;
  value: string;
  selected?: boolean;
};
```

---

## Backend: Form Detection

### `utilities/form-detection.utility.ts`

Source Assistant Backend Core creates the base `detectForms(html, pageUrl): DetectedHtmlForm[]`. This feature adds:

**`detectFormsFromUrl(request: DetectFormsRequest): Promise<DetectFormsResponse>`**
Fetches the page via the shared fetch policy executor, calls `detectForms`, scores and sorts results by confidence score.

**`scoreDetectedForm(form: DetectedHtmlForm): number`**

Scoring weights:
- `+30` `input[type=search]`
- `+25` field named q / query / search / keyword / term / s
- `+20` action URL contains "search"
- `+15` submit button text contains search / filter / find
- `+10` has select filters
- `+5` GET method
- `-40` has password field
- `-30` email-only single-field form
- `-25` action contains login / signin / subscribe / newsletter
- `-15` action contains "comment"
- `-10` no text / search / select fields

Confidence band mapping: score ≥ 30 → `"high"`, 10–29 → `"medium"`, < 10 → `"low"`.

**`detectedFormToRequestConfig(form: DetectedHtmlForm): WebScrapingFormRequestConfig`**
Converts a selected detected form into a `WebScrapingFormRequestConfig`. Excludes disabled, submit, and button fields. Defaults: `followRedirects: true`, `scrape: "finalResponse"`.

**Sensitive field detection**
Mark `sensitive: true` if field name/type/label contains: `password`, `pass`, `token`, `secret`, `apikey`, `auth`, `authorization`, `session`, `cookie`, `csrf`, `nonce`.

**Dynamic hidden field detection**
Mark `dynamic: true` if hidden field name matches: `csrf`, `nonce`, `token`, `authenticity_token`, `__requestverificationtoken`. Emit warning: "This hidden field looks dynamic. Static form submission may fail if this value changes between refreshes."

**Label resolution priority:** `label[for="{id}"]` → closest wrapping `label` → `aria-label` → `placeholder` → name fallback.

### `routes/utils.ts` — `POST /utils/detect-forms`

- Validate URL through Outbound Fetch Policy before fetching
- Call `detectFormsFromUrl`
- Return forms sorted by confidence score descending, with warnings
- If `advanced: true`, return static detection with note: "Advanced rendered form detection is not yet supported. Static HTML forms were detected."

---

## Backend: Form Submission Fetcher

### `utilities/web-scraping-fetcher.utility.ts` (new)

Single dispatcher for all web scraping HTML fetches. Both branches use the shared fetch policy executor — no raw axios calls.

```ts
export type WebScrapingFetchResult = {
  html: string;
  finalUrl: string;
  status?: number;
  durationMs: number;
};

export async function fetchWebScrapingHtml(
  feedConfig: WebScrapingFeedConfig,
): Promise<WebScrapingFetchResult>;
```

`fetchWebScrapingHtml` dispatches to `fetchSimpleWebPage` or `fetchFormResultPage` based on `feedConfig.config.request?.mode`. Missing `request` is treated as simple.

`fetchFormResultPage` responsibilities:
- Resolve `actionUrl` against `baseUrl` if relative or missing
- Decrypt `ProtectedValue` fields before encoding — never log decrypted values
- Encode request body: `URLSearchParams` for urlencoded, `JSON.stringify` for JSON, `FormData` for multipart
- GET forms send fields as query params, not body
- Pass encoded request to shared fetch policy executor
- Return `WebScrapingFetchResult` with `finalUrl` from executor response

### Runtime consumers updated

All three use `fetchWebScrapingHtml` — no direct URL fetches for web scraping:

1. **Worker** (`feed-updater.worker.ts`) — replaces direct fetch with `fetchWebScrapingHtml(feedConfig)`, passes HTML to `buildRSS`
2. **Preview route** — normalizes incoming config, calls `fetchWebScrapingHtml`, builds RSS from result HTML
3. **Selector suggestion route** — accepts `feedConfig?: Partial<WebScrapingFeedConfig>`; uses `fetchWebScrapingHtml` when `request` config is present, existing URL behavior otherwise

---

## Config Layer

### Caster (`feed-config-caster.utility.ts`)

`castWebScrapingRequestConfig(input, context)` maps frontend form state to `WebScrapingRequestConfig`:

Frontend fields: `requestMode`, `formMethod`, `formActionUrl`, `formEncoding`, `formFields[]`, `formFollowRedirects`, `formScrapeMode`.

Fields with `protected: true` become `ProtectedValue`. Missing `requestMode` or `requestMode: "simple"` returns `undefined`.

### Normalizer (`feed-config-normalizer.utility.ts`)

- Missing `request` → treat as simple
- Missing `request.mode` → infer simple
- Form config: normalize method/action/encoding/fields/submit with safe defaults

### Validator (`feed-config-validator.utility.ts`)

**Reject:** unsupported encoding or method, empty field names, file inputs.

**Warn:**
- Sensitive-looking field stored as plain text
- POST form has no fields
- Action URL host differs from `baseUrl` host
- Dynamic hidden token fields detected

---

## Frontend

> **For implementers:** REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.

### New components

| Component | Responsibility |
|---|---|
| `WebScrapingRequestSection.tsx` | Expandable "Form submission" section; collapsed by default |
| `DetectedFormsPicker.tsx` | Card list of detected form candidates with confidence bands and "Recommended" badge |
| `DetectedFormFieldsEditor.tsx` | Table of fields for selected form: Include / Name / Type / Label / Value / Protected / Notes |
| `FormFieldRow.tsx` | Single editable row; select fields show options; hidden fields visually distinct; dynamic token fields show inline warning |

### `WebScrapingForm.tsx` changes

- Adds `WebScrapingRequestSection` above the extraction setup
- "Detect forms from URL" button: idle → detecting → found N forms / no forms found / detection failed
- On form selection, `detectedFormToRequestConfig` result populates form state
- When `requestMode === "form"`, preview and selector suggestion helper text notes that results come from the submitted-form page

### Form state additions

```ts
requestMode?: "simple" | "form";
formMethod?: "GET" | "POST";
formActionUrl?: string;
formEncoding?: "application/x-www-form-urlencoded" | "multipart/form-data" | "application/json";
formFields?: WebScrapingFormFieldInput[];
formFollowRedirects?: boolean;
formScrapeMode?: "responseBody" | "finalResponse";

type WebScrapingFormFieldInput = {
  name: string;
  value: string;
  type?: string;
  include: boolean;
  protected?: boolean;
  required?: boolean;
  hidden?: boolean;
  dynamic?: boolean;
  sensitive?: boolean;
  options?: Array<{ label: string; value: string }>;
};
```

### Source Assistant apply flow

When Source Assistant applies a "configure form" recommendation:
- Sets `requestMode: "form"` in builder state
- Populates `DetectedFormsPicker` with `webScrapingPlan.forms` candidates — no new network request
- Adds "Recommended" badge to the highest-confidence candidate if its `confidenceBand === "high"`
- No form is pre-selected; user makes the final choice

---

## Security

- All `detectFormsFromUrl` and `fetchFormResultPage` calls pass through Outbound Fetch Policy before request and before each redirect follow
- Form field values are never logged at any layer
- Protected field values are encrypted at rest, masked in API responses, resolved to plaintext only inside the fetch executor
- Sensitive fields default to `protected: true` in the UI
- Cross-host action URLs produce a config warning but are not blocked
- Dynamic hidden token fields produce a warning; user is not prevented from saving
- File inputs rejected at the validator layer

---

## Testing

**`tests/web-scraping-form-data.test.ts`**

Form detection:
- Detects GET and POST forms
- Defaults missing method to GET, missing action to page URL, missing enctype to urlencoded
- Resolves relative action URLs against page URL
- Extracts input / select / textarea / hidden fields
- Extracts labels: `label[for]` → wrapping label → aria-label → placeholder → name
- Marks disabled fields, required fields, sensitive fields, dynamic hidden token fields
- Scores search form above newsletter form, login form scores low
- Confidence band maps correctly from score
- Converts detected form to `WebScrapingFormRequestConfig`

Fetcher:
- Simple URL still fetches via shared executor
- GET form sends fields as query params
- POST urlencoded sends encoded body
- POST JSON sends JSON body
- Relative `actionUrl` resolves against `baseUrl`
- Protected fields decrypt before request, are not logged
- `followRedirects: false` respected
- Result includes `html`, `finalUrl`, `status`, `durationMs`

Config layer:
- Missing `request` normalizes as simple
- Form config casts correctly from frontend state
- `protected: true` field becomes `ProtectedValue`
- Invalid encoding rejected, invalid method rejected, empty field names rejected

Runtime:
- Worker uses `fetchWebScrapingHtml`
- Preview uses form result HTML
- Selector suggestion uses form result page when request config present

---

## Acceptance Criteria

- Existing web scraping configs work unchanged
- Web scraping configs support `config.request.mode: form`
- Users can expand Form submission setup in the builder
- Users can detect forms from the entered URL
- Detected forms show method, action URL, encoding, fields, labels, confidence, and warnings
- Source Assistant apply populates the form picker with detected candidates; "Recommended" badge shown on high-confidence pick; user selects
- Users can manually edit field values and mark fields as protected
- Mkfd submits GET, POST urlencoded, and POST JSON forms and scrapes the result
- Preview, selector suggestions, and worker all use the submitted-form result page
- Invalid form configs are rejected with clear validation errors
- Dynamic hidden token fields produce warnings
- Form values are never logged
- Protected form values are masked in API responses and encrypted in saved config
