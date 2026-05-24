## Goal

Extend Mkfd web scraping configs so a user can:

```text
1. Enter a page URL.
2. Expand a “Form submission” setup section.
3. Click “Detect forms from URL.”
4. Let Mkfd inspect the HTML and extract available forms.
5. Select the intended form.
6. Have Mkfd prefill method, action URL, encoding, and fields.
7. Edit field values.
8. Preview/suggest selectors against the resulting submitted-form page.
9. Save the feed config.
10. Let the worker submit the form and scrape the result on every refresh.
```

This turns Mkfd from:

```text
GET this URL and scrape it
```

into:

```text
Submit this form, then scrape the resulting page
```

while preserving existing web scraping configs.

---

# 1. Feature scope

## MVP supports

```text
Static HTML form detection
GET form submission
POST form submission
application/x-www-form-urlencoded
application/json, for manually configured forms
multipart/form-data, without file uploads
input/select/textarea extraction
hidden field extraction
form scoring and labeling
manual field editing after detection
preview from submitted result page
selector suggestion from submitted result page
worker refresh from submitted result page
protected form field values
```

## MVP does not support yet

```text
File uploads
CAPTCHA
Login automation
Browser-driven clicking/filling
Multi-step forms
Dynamic CSRF token refresh
JavaScript-only forms
Automatic submission without user review
```

Future extension:

```text
Advanced browser form flow
Dynamic hidden field extraction
Preflight token extraction
```

---

# 2. Config model changes

Add a request mode to web scraping configs.

Current shape remains valid:

```yaml
feedType: webScraping
config:
  baseUrl: https://example.com/news
```

New form submission shape:

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
      category: notices
      sort: newest
    submit:
      followRedirects: true
      scrape: finalResponse
```

Existing configs without `config.request` behave as simple URL scraping.

---

# 3. Add web scraping request model

Create:

```text
models/web-scraping-request.model.ts
```

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

Update `WebScrapingSourceConfig`:

```ts
import type { FeedCookie, ProtectedRecord } from "./protected-value.model";
import type { WebScrapingRequestConfig } from "./web-scraping-request.model";

export type WebScrapingSourceConfig = {
  baseUrl: string;
  title?: string;
  method?: "GET";
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  timeoutMs?: number;
  userAgent?: string;
  proxyId?: string;
  request?: WebScrapingRequestConfig;
};
```

---

# 4. Add detected form model

Create:

```text
models/html-form-detection.model.ts
```

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
  warnings: string[];
};

export type DetectedHtmlFormField = {
  name: string;
  type:
    | "text"
    | "search"
    | "hidden"
    | "password"
    | "email"
    | "number"
    | "checkbox"
    | "radio"
    | "select"
    | "textarea"
    | "submit"
    | "button"
    | "unknown";
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

# 5. Add form detection utility

Create:

```text
utilities/form-detection.utility.ts
```

Responsibilities:

```text
Fetch HTML for a URL
Parse forms with Cheerio
Extract method/action/enctype
Extract fields
Detect labels/defaults/options
Score likely useful forms
Return forms sorted by confidence
Convert selected form into WebScrapingFormRequestConfig
```

Core API:

```ts
import * as cheerio from "cheerio";
import type {
  DetectFormsRequest,
  DetectFormsResponse,
  DetectedHtmlForm,
  DetectedHtmlFormField,
} from "../models/html-form-detection.model";
import type { WebScrapingFormRequestConfig } from "../models/web-scraping-request.model";

export async function detectFormsFromUrl(
  request: DetectFormsRequest,
): Promise<DetectFormsResponse>;

export function detectFormsFromHtml(
  html: string,
  pageUrl: string,
): DetectedHtmlForm[];

export function scoreDetectedForm(form: DetectedHtmlForm): number;

export function detectedFormToRequestConfig(
  form: DetectedHtmlForm,
): WebScrapingFormRequestConfig;
```

---

# 6. Form detection rules

## Form extraction

For each `<form>`:

```text
method
action
enctype
id/name/class
aria-label
nearby heading
submit button text
input fields
select fields
textarea fields
hidden fields
required fields
default values
```

Defaults:

```text
method: GET
actionUrl: current page URL
encoding: application/x-www-form-urlencoded
```

Helpers:

```ts
export function normalizeFormMethod(value?: string): "GET" | "POST" {
  return value?.toUpperCase() === "POST" ? "POST" : "GET";
}

export function normalizeFormEncoding(
  value?: string,
): "application/x-www-form-urlencoded" | "multipart/form-data" {
  return value === "multipart/form-data"
    ? "multipart/form-data"
    : "application/x-www-form-urlencoded";
}

export function resolveFormActionUrl(action: string | undefined, pageUrl: string) {
  return new URL(action || pageUrl, pageUrl).toString();
}
```

## Field extraction

Extract:

```text
input[name]
select[name]
textarea[name]
button[name]
```

Skip disabled fields by default, but include them in the detected data with `disabled: true` so the UI can show why they are not included.

Field defaults:

```text
text/search/email/number: value attribute or empty string
hidden: value attribute
checkbox/radio: value attribute if checked
select: selected option or first option
textarea: text content
```

## Label extraction

Prefer:

```text
label[for="{id}"]
closest wrapping label
aria-label
placeholder
name fallback
```

## Sensitive field detection

Mark `sensitive: true` if name/type/label contains:

```text
password
pass
token
secret
apiKey
apikey
auth
authorization
session
cookie
csrf
nonce
```

## Dynamic field detection

Mark `dynamic: true` if hidden field name looks like:

```text
csrf
nonce
token
authenticity_token
__requestverificationtoken
```

Warning text:

```text
This hidden field looks dynamic. Static form submission may fail if this value changes between refreshes.
```

---

# 7. Form scoring

Many pages have multiple forms. Score useful search/filter forms higher than login/newsletter/comment forms.

Suggested scoring:

```text
+30 input[type=search]
+25 field name is q/query/search/keyword/term/s
+20 action URL contains search
+15 button text contains search/filter/find
+10 has select filters
+5 method is GET
-40 has password field
-30 email-only form
-25 action contains login/signin/subscribe/newsletter
-20 only one email field
-15 action contains comment
-10 no text/search/select fields
```

Pseudo-code:

```ts
export function scoreDetectedForm(form: DetectedHtmlForm) {
  let score = 0;

  const fieldNames = form.fields.map((field) => field.name.toLowerCase());
  const action = form.actionUrl.toLowerCase();
  const fieldTypes = form.fields.map((field) => field.type);

  if (fieldTypes.includes("search")) score += 30;

  if (
    fieldNames.some((name) =>
      ["q", "query", "search", "keyword", "term", "s"].includes(name),
    )
  ) {
    score += 25;
  }

  if (action.includes("search")) score += 20;

  if (form.method === "GET") score += 5;

  if (fieldTypes.includes("password")) score -= 40;

  if (
    action.includes("login") ||
    action.includes("signin") ||
    action.includes("subscribe") ||
    action.includes("newsletter")
  ) {
    score -= 25;
  }

  const emailFields = form.fields.filter((field) => field.type === "email");
  const nonHiddenFields = form.fields.filter((field) => field.type !== "hidden");

  if (emailFields.length === 1 && nonHiddenFields.length === 1) {
    score -= 30;
  }

  return score;
}
```

---

# 8. Convert detected form to request config

```ts
export function detectedFormToRequestConfig(
  form: DetectedHtmlForm,
): WebScrapingFormRequestConfig {
  return {
    mode: "form",
    method: form.method,
    actionUrl: form.actionUrl,
    encoding: form.encoding,
    fields: Object.fromEntries(
      form.fields
        .filter((field) => field.name)
        .filter((field) => !field.disabled)
        .filter((field) => field.type !== "submit")
        .filter((field) => field.type !== "button")
        .map((field) => [field.name, getDefaultFieldValue(field)]),
    ),
    submit: {
      followRedirects: true,
      scrape: "finalResponse",
    },
  };
}
```

Default field value:

```ts
function getDefaultFieldValue(field: DetectedHtmlFormField) {
  if (field.type === "checkbox") {
    return field.checked ? field.value || "on" : "";
  }

  if (field.type === "radio") {
    return field.checked ? field.value || "on" : "";
  }

  if (field.type === "select") {
    const selected = field.options?.find((option) => option.selected);
    return selected?.value ?? field.options?.[0]?.value ?? "";
  }

  return field.value ?? "";
}
```

---

# 9. Add form detection endpoint

In `index.ts`, add:

```text
POST /utils/detect-forms
```

Flow:

```text
Validate URL
Fetch page HTML
Parse forms
Sort by confidence
Return forms and warnings
```

Pseudo-route:

```ts
app.post("/utils/detect-forms", async (ctx) => {
  const body = await ctx.req.json();

  const result = await detectFormsFromUrl({
    url: String(body.url || ""),
    headers: body.headers,
    cookies: body.cookies,
    advanced: Boolean(body.advanced),
    userAgent: body.userAgent,
    timeoutMs: Number(body.timeoutMs || 30000),
  });

  return ctx.json(result);
});
```

For MVP, if `advanced: true`, return static HTML detection anyway or show:

```text
Advanced rendered form detection is not implemented yet. Static HTML forms were detected.
```

Later, support Patchright-rendered DOM.

---

# 10. Add web scraping fetcher utility

Create:

```text
utilities/web-scraping-fetcher.utility.ts
```

Purpose:

```text
Centralize all HTML fetching for web scraping feeds so preview, selector suggestion, and workers use the same request behavior.
```

Core API:

```ts
import type { WebScrapingFeedConfig } from "../models/feed-config.model";
import type { WebScrapingFormRequestConfig } from "../models/web-scraping-request.model";

export type WebScrapingFetchResult = {
  html: string;
  finalUrl: string;
  status?: number;
  headers?: Record<string, string>;
  durationMs: number;
};

export async function fetchWebScrapingHtml(
  feedConfig: WebScrapingFeedConfig,
): Promise<WebScrapingFetchResult>;

export async function fetchSimpleWebPage(
  feedConfig: WebScrapingFeedConfig,
): Promise<WebScrapingFetchResult>;

export async function fetchFormResultPage(
  feedConfig: WebScrapingFeedConfig,
  request: WebScrapingFormRequestConfig,
): Promise<WebScrapingFetchResult>;
```

Dispatch:

```ts
export async function fetchWebScrapingHtml(
  feedConfig: WebScrapingFeedConfig,
): Promise<WebScrapingFetchResult> {
  const request = feedConfig.config.request;

  if (!request || request.mode === "simple") {
    return fetchSimpleWebPage(feedConfig);
  }

  if (request.mode === "form") {
    return fetchFormResultPage(feedConfig, request);
  }

  throw new Error("Unsupported web scraping request mode.");
}
```

---

# 11. Implement form request submission

## Resolve action URL

```ts
export function resolveFormActionUrl(
  actionUrl: string | undefined,
  baseUrl: string,
) {
  return new URL(actionUrl || baseUrl, baseUrl).toString();
}
```

## Resolve protected field values

```ts
export function resolveFormFields(
  fields: Record<string, WebScrapingFormFieldValue>,
  encryptionKey: string,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      resolveFormFieldValue(value, encryptionKey),
    ]),
  );
}
```

## Encode request

```ts
export function encodeFormBody(
  fields: Record<string, string | string[]>,
  encoding: WebScrapingFormRequestConfig["encoding"],
) {
  if (encoding === "application/json") {
    return JSON.stringify(fields);
  }

  if (encoding === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else {
        params.append(key, value);
      }
    }

    return params.toString();
  }

  if (encoding === "multipart/form-data") {
    const formData = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, item);
      } else {
        formData.append(key, value);
      }
    }

    return formData;
  }

  throw new Error(`Unsupported form encoding: ${encoding}`);
}
```

## Fetch form result

```ts
export async function fetchFormResultPage(
  feedConfig: WebScrapingFeedConfig,
  request: WebScrapingFormRequestConfig,
): Promise<WebScrapingFetchResult> {
  const startedAt = Date.now();
  const actionUrl = resolveFormActionUrl(
    request.actionUrl,
    feedConfig.config.baseUrl,
  );
  const fields = resolveFormFields(
    request.fields,
    process.env.ENCRYPTION_KEY || "",
  );

  const headers = buildFormRequestHeaders(feedConfig, request);

  const response = await axios.request<string>({
    url: actionUrl,
    method: request.method,
    headers,
    params: request.method === "GET" ? fields : undefined,
    data:
      request.method === "POST"
        ? encodeFormBody(fields, request.encoding)
        : undefined,
    maxRedirects: request.submit?.followRedirects === false ? 0 : 5,
    responseType: "text",
    timeout: feedConfig.config.timeoutMs ?? 30000,
  });

  return {
    html: response.data,
    finalUrl: response.request?.res?.responseUrl || actionUrl,
    status: response.status,
    headers: response.headers as Record<string, string>,
    durationMs: Date.now() - startedAt,
  };
}
```

---

# 12. Build request headers

Headers should combine:

```text
top-level feed headers
config-specific headers
user agent
content type
cookies
```

Rules:

```text
Do not override explicit user content-type unless needed.
For urlencoded POST, set Content-Type: application/x-www-form-urlencoded.
For JSON POST, set Content-Type: application/json.
For multipart/form-data, let FormData/fetch set boundary if possible.
```

For Axios multipart, be careful with boundary handling. If Bun/native fetch is easier for `FormData`, use native fetch for the form fetcher.

MVP practical recommendation:

```text
Use Axios for urlencoded and JSON.
Use native fetch for multipart if needed.
Do not support file fields.
```

---

# 13. Update feed config caster

Update:

```text
utilities/feed-config-caster.utility.ts
```

Add:

```ts
export function castWebScrapingRequestConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): WebScrapingRequestConfig | undefined;
```

Expected form fields from frontend:

```text
requestMode
formMethod
formActionUrl
formEncoding
formFields
formFollowRedirects
formScrapeMode
```

Implementation shape:

```ts
export function castWebScrapingRequestConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): WebScrapingRequestConfig | undefined {
  const mode = stringValue(input.requestMode, "simple");

  if (mode === "simple") {
    return undefined;
  }

  if (mode === "form") {
    return {
      mode: "form",
      method: stringValue(input.formMethod, "POST") as "GET" | "POST",
      actionUrl: stringValue(input.formActionUrl, ""),
      encoding: stringValue(
        input.formEncoding,
        "application/x-www-form-urlencoded",
      ) as WebScrapingFormRequestConfig["encoding"],
      fields: castFormFields(input.formFields, context),
      submit: {
        followRedirects: booleanValue(input.formFollowRedirects, true),
        scrape: stringValue(input.formScrapeMode, "finalResponse") as
          | "responseBody"
          | "finalResponse",
      },
    };
  }

  throw new Error(`Unsupported request mode: ${mode}`);
}
```

Then in the web scraping caster:

```ts
config: {
  baseUrl: stringValue(input.feedUrl, ""),
  request: castWebScrapingRequestConfig(input, context),
}
```

---

# 14. Update config normalizer

Update:

```text
utilities/feed-config-normalizer.utility.ts
```

Rules:

```text
If config.request missing, treat as simple.
If request.mode missing, infer simple.
If request.mode is form, normalize method/action/encoding/fields/submit.
If old config.method exists, keep it ignored for normal simple scraping.
```

Normalizer output:

```ts
export function normalizeWebScrapingSourceConfig(input: unknown): WebScrapingSourceConfig {
  const config = objectValue(input, {});

  return {
    baseUrl: stringValue(config.baseUrl, ""),
    title: stringValue(config.title, ""),
    timeoutMs: numberValue(config.timeoutMs, 30000),
    userAgent: stringValue(config.userAgent, ""),
    proxyId: stringValue(config.proxyId, ""),
    headers: normalizeProtectedRecord(config.headers),
    cookies: normalizeCookies(config.cookies),
    request: normalizeWebScrapingRequestConfig(config.request),
  };
}
```

---

# 15. Update feed config validator

Update:

```text
utilities/feed-config-validator.utility.ts
```

Validation rules:

```text
request.mode must be simple or form.
form method must be GET or POST.
actionUrl must be valid if provided.
encoding must be supported.
fields must be an object.
field names cannot be empty.
field values must be string/number/boolean/protected/array.
multipart must not contain files in MVP.
body size estimate must be under configured limit.
```

Warnings:

```text
Sensitive-looking field name is stored plain.
POST form has no fields.
Action URL host differs from base URL host.
Hidden dynamic token was detected.
JSON response detected during preview, consider REST API feed type.
```

Unsupported in MVP:

```text
advanced=true with browser-driven form interaction
file inputs
```

Important distinction:

```text
advanced=true + request.mode=form can still use plain HTTP submission in MVP.
What is unsupported is browserForm steps/click automation.
```

---

# 16. Update worker integration

Update:

```text
feed-updater.worker.ts
```

Before:

```text
worker decides how to fetch web page HTML directly
```

After:

```text
worker calls fetchWebScrapingHtml(feedConfig)
worker passes returned HTML into buildRSS
```

Target flow:

```ts
if (feedConfig.feedType === "webScraping") {
  const fetchResult = await fetchWebScrapingHtml(feedConfig);
  rssXml = await buildRSS(fetchResult.html, feedConfig);
}
```

This consolidates:

```text
simple GET
form GET
form POST
future browser form mode
```

behind one fetcher.

---

# 17. Update preview route

Preview must use the same fetcher.

Target flow:

```ts
const previewConfig = await normalizeIncomingFeedConfig(rawBody, {
  feedId: "preview",
  encryptionKey,
  now: new Date(),
});

if (previewConfig.feedType === "webScraping") {
  const fetchResult = await fetchWebScrapingHtml(previewConfig);
  const rss = await buildRSS(fetchResult.html, previewConfig);
  return ctx.text(rss);
}
```

This ensures the preview is built from the submitted form result page, not from the initial form page.

---

# 18. Update selector suggestion route

Current selector suggestion likely receives just a URL and fetches the page.

Update it to accept either:

```text
URL-only request
```

or:

```text
partial web scraping config with config.request
```

Recommended route:

```text
POST /utils/suggest-selectors
```

Payload:

```ts
export type SuggestSelectorsRequest = {
  url?: string;
  feedConfig?: Partial<WebScrapingFeedConfig>;
};
```

Behavior:

```text
If feedConfig.config.request exists:
  use fetchWebScrapingHtml
Else:
  use existing fetch behavior
```

Result:

```text
Suggestions are generated from the submitted form result page.
```

This is essential for the UX.

---

# 19. Frontend changes

## Add components

```text
WebScrapingRequestSection.tsx
DetectedFormsPicker.tsx
DetectedFormFieldsEditor.tsx
FormFieldRow.tsx
```

## Update `WebScrapingForm.tsx`

Add section:

```text
Request setup
```

Default collapsed or simple mode.

UI structure:

```text
Request setup

Mode
[ Simple URL ]

Expandable:
[ Form submission ]

Inside Form submission:
[Detect forms from URL]

Detected forms:
- Search form
- Newsletter signup
- Login form

Selected form:
Method
Action URL
Encoding
Fields
Follow redirects
Scrape final response
```

## Field row UI

```text
Include | Name | Type | Label | Value | Protected | Notes
```

Support field edits:

```text
name
value
include/exclude
protected
```

For select fields, use detected options.

For hidden fields, show as collapsible or visually distinct.

For dynamic hidden fields, show warning.

---

# 20. Frontend form state shape

Add to `FeedBuilderForm` form state:

```ts
requestMode?: "simple" | "form";
formMethod?: "GET" | "POST";
formActionUrl?: string;
formEncoding?:
  | "application/x-www-form-urlencoded"
  | "multipart/form-data"
  | "application/json";
formFields?: WebScrapingFormFieldInput[];
formFollowRedirects?: boolean;
formScrapeMode?: "responseBody" | "finalResponse";
```

Field input type:

```ts
export type WebScrapingFormFieldInput = {
  name: string;
  value: string;
  type?: string;
  include: boolean;
  protected?: boolean;
  required?: boolean;
  hidden?: boolean;
  dynamic?: boolean;
  sensitive?: boolean;
  options?: Array<{
    label: string;
    value: string;
  }>;
};
```

When a detected form is selected, populate these fields from `detectedFormToRequestConfig`.

---

# 21. Detect forms button flow

Frontend flow:

```text
User enters URL.
User expands Form submission setup.
User clicks Detect forms from URL.
Frontend POSTs to /utils/detect-forms.
Backend returns forms sorted by confidence.
Frontend shows cards/radio list.
User selects a form.
Frontend pre-fills method/action/encoding/fields.
User edits values.
```

Button states:

```text
Detect forms from URL
Detecting...
No forms found
3 forms found
Detection failed
```

Warnings:

```text
No forms detected. Try Advanced mode or enter form details manually.
This form contains a password field. Mkfd does not support login automation.
This form contains a dynamic hidden token. Static submission may fail later.
```

---

# 22. Form cards UX

Detected form card should show:

```text
Label
Method
Action host/path
Field count
Confidence
Warnings
```

Example:

```text
Search form
GET /search
Fields: q, category, sort
Confidence: high
```

Lower-confidence example:

```text
Newsletter signup
POST /subscribe
Fields: email
Confidence: low
Warning: Email-only forms are usually not useful feed sources.
```

---

# 23. Selector suggestion UX update

In `WebScrapingForm.tsx`, when user clicks **Suggest Selectors**:

```text
If requestMode === form:
  submit partial config including request setup
  backend submits form
  suggestions are generated from result page
Else:
  existing URL behavior
```

Show helper text:

```text
Selector suggestions will be generated from the page returned after submitting this form.
```

---

# 24. Preview UX update

When request mode is form, preview button should show:

```text
Submitting form and generating preview...
```

If preview response is JSON:

```text
This form returned JSON instead of HTML. This may work better as a REST API feed.
```

If result has zero selector matches:

```text
The form submitted successfully, but your iterator selector matched no items on the result page.
```

---

# 25. Template system integration

This feature should work with parameterized config templates.

Example catalog config:

```yaml
template:
  variables:
    searchTerm:
      label: Search term
      type: string
      required: true

config:
  baseUrl: https://example.com/search
  request:
    mode: form
    method: POST
    actionUrl: https://example.com/search/results
    encoding: application/x-www-form-urlencoded
    fields:
      q: "{{ searchTerm }}"
      sort: newest
```

Import flow:

```text
Catalog import form asks for searchTerm.
Template renderer injects value into form fields.
Saved local config contains concrete form field values.
```

Catalog CI must allow declared placeholders inside `config.request.fields`.

---

# 26. Security considerations

Add safeguards:

```text
Do not log form field values.
Mask protected form fields in API responses.
Do not include protected values in preview output.
Limit form body size.
Limit redirects.
Limit timeout.
Warn on cross-host form action URLs.
Warn on sensitive fields stored plain.
Reject file inputs in MVP.
Do not auto-submit detected forms without user selecting one.
Do not scrape login forms by default.
```

Sensitive fields should default to protected storage.

Potential config warning:

```text
The field "token" looks sensitive. Store it encrypted?
```

For community catalog:

```text
Reject hard-coded sensitive form field values.
Allow template secret placeholders.
Reject private URLs unless specifically allowed by local-only/private template policy.
```

---

# 27. Testing plan

## Form detection tests

```text
Detects GET form.
Detects POST form.
Defaults missing method to GET.
Defaults missing action to page URL.
Resolves relative action URL.
Detects enctype multipart/form-data.
Extracts input fields.
Extracts hidden fields.
Extracts select options.
Extracts textarea values.
Extracts labels from label[for].
Extracts labels from wrapping label.
Marks disabled fields.
Marks required fields.
Marks sensitive fields.
Marks dynamic hidden token fields.
Scores search form above newsletter form.
Scores login form low.
Converts detected form into WebScrapingFormRequestConfig.
```

## Fetcher tests

```text
Simple URL still fetches normally.
GET form sends fields as query params.
POST urlencoded sends fields in body.
POST JSON sends JSON body.
POST multipart builds FormData.
Relative actionUrl resolves against baseUrl.
Protected form fields resolve before request.
Redirect behavior respects followRedirects.
Fetch result includes html, finalUrl, status, durationMs.
```

## Caster/normalizer tests

```text
Missing config.request normalizes as simple.
Form config casts correctly from frontend state.
Form fields with protected flag become ProtectedValue.
Invalid encoding is rejected.
Invalid method is rejected.
Empty field names are rejected.
```

## Preview tests

```text
Preview uses form-submitted result HTML.
Preview handles zero selector matches clearly.
Preview warns on JSON response.
```

## Selector suggestion tests

```text
Suggest selectors uses submitted result page.
Suggest selectors still works for simple URL configs.
```

## Worker tests

```text
Worker refreshes simple web scraping feeds.
Worker refreshes GET form feeds.
Worker refreshes POST form feeds.
Worker does not log form values.
Worker handles form request failures gracefully.
```

---

# 28. Implementation phases

## Phase 1: Models

```text
Add web-scraping-request.model.ts.
Add html-form-detection.model.ts.
Extend WebScrapingSourceConfig with request.
Update FeedConfig model imports.
```

## Phase 2: Form detection backend

```text
Add form-detection.utility.ts.
Implement detectFormsFromHtml.
Implement scoring.
Implement detectedFormToRequestConfig.
Add POST /utils/detect-forms.
```

## Phase 3: Shared web scraping fetcher

```text
Add web-scraping-fetcher.utility.ts.
Move simple fetch logic from worker into fetcher.
Add fetchFormResultPage.
Support GET and POST form submission.
Support urlencoded and JSON body.
Add multipart without file uploads if practical.
```

## Phase 4: Config casting/normalization/validation

```text
Update feed-config-caster.utility.ts.
Update feed-config-normalizer.utility.ts.
Update feed-config-validator.utility.ts.
Support protected form fields.
Add sensitive-field warnings.
```

## Phase 5: Worker and preview integration

```text
Update feed-updater.worker.ts to use fetchWebScrapingHtml.
Update /preview to use fetchWebScrapingHtml.
Ensure buildRSS receives result HTML.
```

## Phase 6: Selector suggestion integration

```text
Update /utils/suggest-selectors payload.
Allow full or partial web scraping config.
Use fetchWebScrapingHtml when request config is present.
Generate selector suggestions from result HTML.
```

## Phase 7: Frontend expandable setup

```text
Add WebScrapingRequestSection.tsx.
Add DetectedFormsPicker.tsx.
Add DetectedFormFieldsEditor.tsx.
Add FormFieldRow.tsx.
Wire Detect forms from URL button.
Prefill request config from selected form.
Allow manual editing.
```

## Phase 8: UI polish and warnings

```text
Add high/medium/low confidence display.
Add warnings for login/newsletter/dynamic-token forms.
Add protected field toggle.
Add preview helper text for form result page.
Add selector suggestion helper text.
```

## Phase 9: Template/catalog compatibility

```text
Allow config.request.fields in template renderer.
Allow placeholders inside form fields.
Update catalog CI rules.
Document parameterized form submission recipes.
```

## Phase 10: Documentation

```text
Document simple URL vs form submission mode.
Add example GET search form config.
Add example POST search form config.
Add limitations: no CAPTCHA, no login automation, no dynamic CSRF refresh in MVP.
Add troubleshooting notes.
```

---

# 29. README to-do item

Add:

```md
- [ ] Web scraping form submission mode
  - Add `config.request` support for submitting GET/POST forms before scraping.
  - Add an expandable GUI setup that detects forms from the entered URL.
  - Extract form method, action URL, encoding, fields, labels, defaults, and select options from HTML.
  - Let users select a detected form, edit field values, and mark sensitive fields as protected.
  - Run preview, selector suggestions, and feed refreshes against the submitted-form result page.
  - Support `application/x-www-form-urlencoded` and JSON bodies in the MVP.
  - Leave browser-driven form flows, dynamic CSRF refresh, file uploads, login automation, and CAPTCHA handling for later.
```

---

# 30. Acceptance criteria

The feature is complete when:

```text
Existing web scraping configs still work unchanged.
Web scraping configs can declare config.request.mode: form.
Users can expand Form submission setup in the GUI.
Users can detect forms from the entered URL.
Detected forms include method, action URL, encoding, fields, labels, defaults, and warnings.
Users can select a detected form and prefill the request setup.
Users can manually edit form field values.
Users can mark sensitive form fields as protected.
Mkfd can submit GET forms and scrape the result.
Mkfd can submit POST urlencoded forms and scrape the result.
Mkfd can submit POST JSON forms and scrape the result.
Preview uses the submitted form result page.
Selector suggestions use the submitted form result page.
Workers refresh feeds using the submitted form result page.
Invalid form configs are rejected with clear validation errors.
Dynamic hidden fields produce warnings.
Form values are not logged.
Protected form values are masked in API responses and encrypted in saved YAML.
```

# Recommended first implementation cut

Build this first:

```text
Static HTML form detection
Detected form picker
GET form submission
POST application/x-www-form-urlencoded
Manual field editing
Preview support
Selector suggestion support
Worker support
```

Then add:

```text
JSON body support
Protected form fields
Multipart without files
Template support
Advanced rendered-form detection
Dynamic hidden field extraction
```

# Final design principle

Treat form submission as part of the **web scraping request setup**, not as headers/cookies.

The final pipeline should be:

```text
request setup
  -> simple URL or submitted form
  -> resulting HTML
  -> selector suggestions / preview / worker extraction
  -> generated feeds
```

That keeps the feature powerful, understandable, and compatible with Mkfd’s existing selector-based scraping model.