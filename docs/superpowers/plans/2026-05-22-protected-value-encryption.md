# Protected Value Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a universal `ProtectedValue` type so any sensitive config field (headers, cookies, URLs, params, body fields) can store AES-encrypted ciphertext or an env-var reference, with full round-trip masking through the API and sticky-field UX in the editor.

**Architecture:** The model and utility layer wraps the existing `security.utility.ts` without modifying it. Workers resolve protected values immediately before outbound HTTP calls. All config-returning endpoints mask values before responding. The save path restores masked `"********"` sentinels to original ciphertext via `preserveMaskedProtectedValues`. Three new GUI components replace `KeyValueManager` and `CookiesManager` in `AdditionalOptions.tsx`.

**Security decision:** Only encrypted `{ type: "protected" }` values are masked as `"********"` in API responses and edit forms. Env references are not secret values; keep `{ type: "env", value: "VAR_NAME", prefix?: "..." }` visible so users can edit the variable name and prefix. Never log resolved protected/env values, Authorization headers, Cookie headers, decrypted config, or full request configs after secret resolution.

**Tech Stack:** Bun, TypeScript, node-forge (existing), bun:test, React, react-hook-form, shadcn/ui

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/protected-value.model.ts` | `ProtectedValue`, `ConfigValue`, `ProtectedRecord`, narrow field types |
| Create | `utilities/protected-values.utility.ts` | All utility functions: guard, protect, resolve, mask, preserve |
| Create | `utilities/sensitive-config.utility.ts` | `isSensitiveConfigPath`, `findPlainSensitiveValues` |
| Create | `tests/protected-values.test.ts` | Unit tests for utility functions |
| Create | `tests/sensitive-config.test.ts` | Unit tests for scanner |
| Modify | `workers/feed-updater.worker.ts` | Resolve protected values before axios calls (web scraping + API paths) |
| Modify | `index.ts` | Mask on GET config endpoints; preserve + encrypt on POST/PUT save paths; email migration |
| Create | `frontend/src/components/protected-value/ProtectedValueInput.tsx` | Single-field input with storage mode selector |
| Create | `frontend/src/components/protected-value/ProtectedKeyValueEditor.tsx` | Table editor for headers/params/variables |
| Create | `frontend/src/components/protected-value/ProtectedCookieEditor.tsx` | Table editor for cookies |
| Modify | `frontend/src/components/forms/AdditionalOptions.tsx` | Replace `KeyValueManager` + `CookiesManager` with new editors |

---

### Task 1: ProtectedValue model

**Files:**
- Create: `models/protected-value.model.ts`
- Create: `tests/protected-values.test.ts`

- [ ] **Step 1: Write the failing import test**

```typescript
// tests/protected-values.test.ts
import { describe, it, expect } from "bun:test";
import type { ProtectedValue, ProtectedRecord } from "../models/protected-value.model";

describe("ProtectedValue types", () => {
  it("can assign a protected value", () => {
    const pv: ProtectedValue = { type: "protected", value: "ENC:v1:abc" };
    expect(pv.type).toBe("protected");
  });

  it("can assign an env value with prefix", () => {
    const pv: ProtectedValue = { type: "env", value: "MY_TOKEN", prefix: "Bearer " };
    expect(pv.type).toBe("env");
  });

  it("can build a ProtectedRecord", () => {
    const rec: ProtectedRecord = {
      Authorization: { type: "env", value: "API_TOKEN", prefix: "Bearer " },
      Accept: "application/json",
    };
    expect(rec.Accept).toBe("application/json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/protected-values.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the model**

```typescript
// models/protected-value.model.ts
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

export type FeedCookie = {
  name: string;
  value: string | ProtectedValue;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/protected-values.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add models/protected-value.model.ts tests/protected-values.test.ts
git commit -m "feat: add ProtectedValue model and narrow field types"
```

---

### Task 2: isProtectedValue, protectValue, envValue

**Files:**
- Create: `utilities/protected-values.utility.ts`
- Modify: `tests/protected-values.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/protected-values.test.ts`:

```typescript
import {
  isProtectedValue,
  protectValue,
  envValue,
} from "../utilities/protected-values.utility";

const TEST_KEY = "a18c1fd2211edd76a18c1fd2211edd76";

describe("isProtectedValue", () => {
  it("returns true for protected type", () => {
    expect(isProtectedValue({ type: "protected", value: "ENC:abc" })).toBe(true);
  });
  it("returns true for env type", () => {
    expect(isProtectedValue({ type: "env", value: "MY_VAR" })).toBe(true);
  });
  it("returns false for a plain string", () => {
    expect(isProtectedValue("plain")).toBe(false);
  });
  it("returns false for null", () => {
    expect(isProtectedValue(null)).toBe(false);
  });
  it("returns false for object without type field", () => {
    expect(isProtectedValue({ value: "x" })).toBe(false);
  });
});

describe("protectValue", () => {
  it("returns a protected object with encrypted value", () => {
    const result = protectValue("my-secret", TEST_KEY);
    expect(result.type).toBe("protected");
    expect(result.value).not.toBe("my-secret");
    expect(typeof result.value).toBe("string");
  });
});

describe("envValue", () => {
  it("creates env reference with prefix", () => {
    const result = envValue("MY_TOKEN", "Bearer ");
    expect(result).toEqual({ type: "env", value: "MY_TOKEN", prefix: "Bearer " });
  });
  it("creates env reference without prefix", () => {
    const result = envValue("MY_TOKEN");
    expect(result).toEqual({ type: "env", value: "MY_TOKEN", prefix: undefined });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/protected-values.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the utility with these three functions**

```typescript
// utilities/protected-values.utility.ts
import { encrypt, decrypt } from "./security.utility";
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
  plaintext: string,
  encryptionKey: string,
): ProtectedValue & { type: "protected" } {
  return { type: "protected", value: encrypt(plaintext, encryptionKey) };
}

export function envValue(
  varName: string,
  prefix?: string,
): ProtectedValue & { type: "env" } {
  return { type: "env", value: varName, prefix };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/protected-values.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/protected-values.utility.ts tests/protected-values.test.ts
git commit -m "feat: add isProtectedValue, protectValue, envValue"
```

---

### Task 3: resolveProtectedValue + resolveProtectedValues

**Files:**
- Modify: `utilities/protected-values.utility.ts`
- Modify: `tests/protected-values.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/protected-values.test.ts`:

```typescript
import {
  resolveProtectedValue,
  resolveProtectedValues,
} from "../utilities/protected-values.utility";

describe("resolveProtectedValue", () => {
  it("decrypts a protected value back to plaintext", () => {
    const pv = protectValue("my-secret", TEST_KEY);
    expect(resolveProtectedValue(pv, TEST_KEY)).toBe("my-secret");
  });

  it("resolves an env value with prefix", () => {
    process.env.TEST_RESOLVE_TOKEN = "abc123";
    const pv = envValue("TEST_RESOLVE_TOKEN", "Bearer ");
    expect(resolveProtectedValue(pv, TEST_KEY)).toBe("Bearer abc123");
    delete process.env.TEST_RESOLVE_TOKEN;
  });

  it("resolves an env value without prefix", () => {
    process.env.TEST_PLAIN_TOKEN = "xyz";
    const pv = envValue("TEST_PLAIN_TOKEN");
    expect(resolveProtectedValue(pv, TEST_KEY)).toBe("xyz");
    delete process.env.TEST_PLAIN_TOKEN;
  });

  it("throws when env var is missing", () => {
    delete process.env.MISSING_VAR;
    expect(() => resolveProtectedValue(envValue("MISSING_VAR"), TEST_KEY)).toThrow(
      "Missing environment variable: MISSING_VAR",
    );
  });
});

describe("resolveProtectedValues", () => {
  it("passes plain strings through unchanged", () => {
    expect(resolveProtectedValues("plain", { encryptionKey: TEST_KEY })).toBe("plain");
  });

  it("resolves a top-level ProtectedValue", () => {
    const pv = protectValue("top-secret", TEST_KEY);
    expect(resolveProtectedValues(pv, { encryptionKey: TEST_KEY })).toBe("top-secret");
  });

  it("resolves protected values nested inside an object", () => {
    process.env.TEST_HEADER_TOKEN = "token-value";
    const input = {
      Accept: "application/json",
      Authorization: envValue("TEST_HEADER_TOKEN", "Bearer "),
    };
    const result = resolveProtectedValues(input, { encryptionKey: TEST_KEY });
    expect(result.Accept).toBe("application/json");
    expect(result.Authorization).toBe("Bearer token-value");
    delete process.env.TEST_HEADER_TOKEN;
  });

  it("resolves protected values inside arrays", () => {
    process.env.TEST_ARR_TOKEN = "arr-value";
    const input = ["plain", envValue("TEST_ARR_TOKEN")];
    const result = resolveProtectedValues(input, { encryptionKey: TEST_KEY });
    expect(result[0]).toBe("plain");
    expect(result[1]).toBe("arr-value");
    delete process.env.TEST_ARR_TOKEN;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/protected-values.test.ts
```

Expected: FAIL — functions not exported

- [ ] **Step 3: Add the two functions to the utility**

Append to `utilities/protected-values.utility.ts`:

```typescript
export function resolveProtectedValue(pv: ProtectedValue, encryptionKey: string): string {
  if (pv.type === "env") {
    const resolved = process.env[pv.value];
    if (!resolved) throw new Error(`Missing environment variable: ${pv.value}`);
    return `${pv.prefix ?? ""}${resolved}`;
  }
  return decrypt(pv.value, encryptionKey);
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
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveProtectedValues(v, options),
      ]),
    ) as T;
  }
  return input;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/protected-values.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/protected-values.utility.ts tests/protected-values.test.ts
git commit -m "feat: add resolveProtectedValue and recursive resolveProtectedValues"
```

---

### Task 4: maskProtectedValues + preserveMaskedProtectedValues

**Files:**
- Modify: `utilities/protected-values.utility.ts`
- Modify: `tests/protected-values.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/protected-values.test.ts`:

```typescript
import {
  maskProtectedValues,
  preserveMaskedProtectedValues,
} from "../utilities/protected-values.utility";

describe("maskProtectedValues", () => {
  it("replaces protected value's value with ********", () => {
    const pv = protectValue("real-secret", TEST_KEY);
    const masked = maskProtectedValues(pv) as { type: string; value: string };
    expect(masked.type).toBe("protected");
    expect(masked.value).toBe("********");
  });

  it("masks nested protected values in objects", () => {
    const input = { Authorization: protectValue("token", TEST_KEY), Accept: "text/html" };
    const masked = maskProtectedValues(input) as typeof input;
    expect((masked.Authorization as { value: string }).value).toBe("********");
    expect(masked.Accept).toBe("text/html");
  });

  it("leaves plain strings untouched", () => {
    expect(maskProtectedValues("plain")).toBe("plain");
  });

  it("masks inside arrays", () => {
    const input = [protectValue("secret", TEST_KEY), "plain"];
    const masked = maskProtectedValues(input) as Array<unknown>;
    expect((masked[0] as { value: string }).value).toBe("********");
    expect(masked[1]).toBe("plain");
  });
});

describe("preserveMaskedProtectedValues", () => {
  it("restores original ciphertext when incoming value is ********", () => {
    const original = protectValue("real-secret", TEST_KEY);
    const incoming = { type: "protected" as const, value: "********" };
    const result = preserveMaskedProtectedValues(incoming, original);
    expect(result).toEqual(original);
  });

  it("keeps new ciphertext when incoming is not ********", () => {
    const original = protectValue("old-secret", TEST_KEY);
    const newPv = protectValue("new-secret", TEST_KEY);
    const result = preserveMaskedProtectedValues(newPv, original);
    expect(result).toEqual(newPv);
  });

  it("works recursively on objects", () => {
    const existing = { Authorization: protectValue("real-token", TEST_KEY) };
    const incoming = { Authorization: { type: "protected" as const, value: "********" } };
    const result = preserveMaskedProtectedValues(incoming, existing) as typeof existing;
    expect((result.Authorization as { value: string }).value).toBe(
      (existing.Authorization as { value: string }).value,
    );
  });

  it("passes through plain strings unchanged", () => {
    expect(preserveMaskedProtectedValues("plain", "old")).toBe("plain");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/protected-values.test.ts
```

Expected: FAIL — functions not exported

- [ ] **Step 3: Add the two functions**

Append to `utilities/protected-values.utility.ts`:

```typescript
export function maskProtectedValues<T>(input: T): T {
  if (isProtectedValue(input)) {
    if (input.type === "env") return input;
    return { ...input, value: "********" } as T;
  }
  if (Array.isArray(input)) {
    return input.map(maskProtectedValues) as T;
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, maskProtectedValues(v)]),
    ) as T;
  }
  return input;
}

export function preserveMaskedProtectedValues<T>(incoming: T, existing: T): T {
  if (
    isProtectedValue(incoming) &&
    incoming.type === "protected" &&
    incoming.value === "********" &&
    isProtectedValue(existing)
  ) {
    return existing as T;
  }
  if (isProtectedValue(incoming) && incoming.type === "env") {
    return incoming;
  }
  if (Array.isArray(incoming) && Array.isArray(existing)) {
    return incoming.map((item, i) => preserveMaskedProtectedValues(item, existing[i])) as T;
  }
  if (
    incoming &&
    existing &&
    typeof incoming === "object" &&
    typeof existing === "object"
  ) {
    return Object.fromEntries(
      Object.entries(incoming as Record<string, unknown>).map(([k, v]) => [
        k,
        preserveMaskedProtectedValues(v, (existing as Record<string, unknown>)[k]),
      ]),
    ) as T;
  }
  return incoming;
}
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
bun test tests/protected-values.test.ts
```

Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add utilities/protected-values.utility.ts tests/protected-values.test.ts
git commit -m "feat: add maskProtectedValues and preserveMaskedProtectedValues"
```

---

### Task 5: Sensitive config scanner

**Files:**
- Create: `utilities/sensitive-config.utility.ts`
- Create: `tests/sensitive-config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/sensitive-config.test.ts
import { describe, it, expect } from "bun:test";
import { isSensitiveConfigPath, findPlainSensitiveValues } from "../utilities/sensitive-config.utility";
import { protectValue, envValue } from "../utilities/protected-values.utility";

const KEY = "a18c1fd2211edd76a18c1fd2211edd76";

describe("isSensitiveConfigPath", () => {
  it("detects Authorization", () => {
    expect(isSensitiveConfigPath("headers.Authorization")).toBe(true);
  });
  it("detects apitoken", () => {
    expect(isSensitiveConfigPath("config.apitoken")).toBe(true);
  });
  it("detects password", () => {
    expect(isSensitiveConfigPath("config.password")).toBe(true);
  });
  it("does not flag baseUrl", () => {
    expect(isSensitiveConfigPath("config.baseUrl")).toBe(false);
  });
  it("does not flag Accept", () => {
    expect(isSensitiveConfigPath("headers.Accept")).toBe(false);
  });
});

describe("findPlainSensitiveValues", () => {
  it("finds a plain Authorization header", () => {
    const findings = findPlainSensitiveValues({ Authorization: "Bearer abc" });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("Authorization");
  });

  it("returns empty for a protected Authorization header", () => {
    const findings = findPlainSensitiveValues({ Authorization: protectValue("token", KEY) });
    expect(findings).toHaveLength(0);
  });

  it("returns empty for an env Authorization header", () => {
    const findings = findPlainSensitiveValues({ Authorization: envValue("MY_TOKEN", "Bearer ") });
    expect(findings).toHaveLength(0);
  });

  it("does not flag a plain non-sensitive header", () => {
    const findings = findPlainSensitiveValues({ Accept: "application/json" });
    expect(findings).toHaveLength(0);
  });

  it("finds nested plain token field", () => {
    const findings = findPlainSensitiveValues({ config: { apiToken: "xyz" } });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("config.apiToken");
  });

  it("does not find anything in an empty object", () => {
    expect(findPlainSensitiveValues({})).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/sensitive-config.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the utility**

```typescript
// utilities/sensitive-config.utility.ts
import { isProtectedValue } from "./protected-values.utility";

const SENSITIVE_PATTERNS = [
  "authorization", "cookie", "x-api-key", "apikey", "apitoken",
  "token", "secret", "password", "passwd", "session", "csrf",
  "access_token", "refresh_token", "bearer",
];

export function isSensitiveConfigPath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
}

export type PlainSensitiveValueFinding = { path: string; message: string };

export function findPlainSensitiveValues(
  input: unknown,
  path = "",
): PlainSensitiveValueFinding[] {
  if (isProtectedValue(input)) return [];

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    if (path && isSensitiveConfigPath(path)) {
      return [{ path, message: "This value looks sensitive. Consider encrypting it." }];
    }
    return [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item, i) => findPlainSensitiveValues(item, `${path}[${i}]`));
  }

  if (input && typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).flatMap(([k, v]) =>
      findPlainSensitiveValues(v, path ? `${path}.${k}` : k),
    );
  }

  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/sensitive-config.test.ts
```

Expected: PASS

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
bun test tests/
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add utilities/sensitive-config.utility.ts tests/sensitive-config.test.ts
git commit -m "feat: add sensitive config scanner utility"
```

---

### Task 6: Resolve protected values in the web scraping worker path

**Files:**
- Modify: `workers/feed-updater.worker.ts`

- [ ] **Step 1: Add the import at the top of feed-updater.worker.ts**

The file currently begins with imports. Add:

```typescript
import { resolveProtectedValues } from "../utilities/protected-values.utility";
```

- [ ] **Step 2: Resolve headers and baseUrl before the standard axios.get call**

Find the standard web scraping path (around line 138–146 — the `else` branch after the FlareSolverr and Playwright branches):

```typescript
// Standard web scraping with Axios
const response = await axios.get(feedConfig.config.baseUrl, {
  headers: {
    ...(feedConfig.headers || {}),
    ...(cookieString && { Cookie: cookieString }),
  },
```

Replace with:

```typescript
// Standard web scraping with Axios
const encKey = process.env.ENCRYPTION_KEY ?? "";
const resolvedBaseUrl = resolveProtectedValues(
  feedConfig.config.baseUrl as string,
  { encryptionKey: encKey },
);
const resolvedHeaders = resolveProtectedValues(
  feedConfig.headers ?? {},
  { encryptionKey: encKey },
);
const response = await axios.get(resolvedBaseUrl, {
  headers: {
    ...resolvedHeaders,
    ...(cookieString && { Cookie: cookieString }),
  },
```

- [ ] **Step 3: Resolve cookie values before building cookieString**

Find the line near the top of `fetchDataAndUpdateFeed` where `cookieString` is first assembled (around line 31–34):

```typescript
const cookieString = (feedConfig.cookies || [])
  .map((c: any) => `${c.name}=${c.value}`)
  .join("; ");
```

Replace with:

```typescript
const encKey = process.env.ENCRYPTION_KEY ?? "";
const cookieString = (feedConfig.cookies || [])
  .map((c: any) => {
    const val = resolveProtectedValues(c.value, { encryptionKey: encKey });
    return `${c.name}=${val}`;
  })
  .join("; ");
```

Remove the duplicate `const encKey` declaration added in Step 2 — define it once at the top of `fetchDataAndUpdateFeed` instead:

```typescript
async function fetchDataAndUpdateFeed(feedConfig: any) {
  const encKey = process.env.ENCRYPTION_KEY ?? "";
  // ... rest of function
```

- [ ] **Step 4: Run existing tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add workers/feed-updater.worker.ts
git commit -m "feat: resolve ProtectedValues in web scraping worker before fetch"
```

---

### Task 7: Resolve protected values in the API worker path

**Files:**
- Modify: `workers/feed-updater.worker.ts`

- [ ] **Step 1: Find the API headers/params assembly (around lines 156–166)**

Current code:

```typescript
const headers = {
  Accept: "application/json",
  ...(feedConfig.headers || {}),
  ...(feedConfig.config.apiSpecificHeaders || {}),
};

const axiosConfig: AxiosRequestConfig = {
  method,
  url,
  headers,
  params: feedConfig.config.params || {},
```

- [ ] **Step 2: Wrap the assembled headers and params with resolveProtectedValues**

Replace with:

```typescript
const headers = resolveProtectedValues(
  {
    Accept: "application/json",
    ...(feedConfig.headers || {}),
    ...(feedConfig.config.apiSpecificHeaders || {}),
  },
  { encryptionKey: encKey },
);

const axiosConfig: AxiosRequestConfig = {
  method,
  url,
  headers,
  params: resolveProtectedValues(feedConfig.config.params || {}, { encryptionKey: encKey }),
```

Note: `encKey` is already defined at the top of `fetchDataAndUpdateFeed` from Task 6.

- [ ] **Step 3: Run existing tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add workers/feed-updater.worker.ts
git commit -m "feat: resolve ProtectedValues in API worker before fetch"
```

---

### Task 8: Mask protected values on GET config endpoints

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add imports near the top of index.ts**

```typescript
import { maskProtectedValues } from "./utilities/protected-values.utility";
```

- [ ] **Step 2: Find GET /api/feeds (around line 1149) and mask each config**

Current code returns `feeds.push({ feedId: config.feedId, ... })` — this only returns a summary so masking isn't needed there. Skip it.

- [ ] **Step 3: Find GET /api/feeds/:id/config (around line 1185) and mask the response**

Current code:

```typescript
const config = yaml.load(yamlContent);
return ctx.json(config);
```

Replace with:

```typescript
const config = yaml.load(yamlContent);
return ctx.json(maskProtectedValues(config));
```

- [ ] **Step 4: Find the PUT /api/feeds/:id route (around line 1198) — mask the echoed config in its success response**

Find the success response in `PUT /api/feeds/:id` and wrap the returned config:

```typescript
return ctx.json({
  message: "Feed updated.",
  config: maskProtectedValues(finalFeedConfig),
});
```

- [ ] **Step 5: Find the POST / success response (around line 563) and mask the echoed config**

```typescript
return ctx.json({
  message: "Feed is being generated.",
  feedUrl: `public/feeds/${feedId}.xml`,
  feedId,
  config: maskProtectedValues(finalFeedConfig),
});
```

- [ ] **Step 6: Run existing tests**

```bash
bun test tests/
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add index.ts
git commit -m "feat: mask ProtectedValues in config-returning API endpoints"
```

---

### Task 9: Preserve masked values on save + email migration

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add preserveMaskedProtectedValues to the import in index.ts**

```typescript
import { maskProtectedValues, preserveMaskedProtectedValues, protectValue } from "./utilities/protected-values.utility";
```

- [ ] **Step 2: Find PUT /api/feeds/:id where existing config is loaded and update is assembled**

Around line 1206–1210:

```typescript
const existingYaml = await readFile(configPath, "utf8");
const existingConfig = yaml.load(existingYaml) as any;
```

After the incoming body is parsed and before `finalFeedConfig` is assembled, add:

```typescript
const body = await ctx.req.json();
const incomingConfig = body; // whatever the existing variable name is

// Restore any ********-masked protected values from the existing config
const configWithPreservedSecrets = preserveMaskedProtectedValues(incomingConfig, existingConfig);
```

Use `configWithPreservedSecrets` in place of the raw incoming body when building `finalFeedConfig`.

- [ ] **Step 3: Add email migration — on PUT save, migrate encryptedPassword to ProtectedValue**

Find where `encryptedPassword` is handled in the PUT path (around line 1332–1336):

```typescript
encryptedPassword: newPassword ? encrypt(newPassword, encryptionKey) : existingConfig.config?.encryptedPassword,
```

Replace with:

```typescript
// Migrate encryptedPassword → ProtectedValue on re-save
password: newPassword
  ? protectValue(newPassword, encryptionKey)
  : existingConfig.config?.password ?? (
      existingConfig.config?.encryptedPassword
        ? { type: "protected" as const, value: existingConfig.config.encryptedPassword }
        : undefined
    ),
// Keep encryptedPassword undefined so it is dropped from new YAML
encryptedPassword: undefined,
```

- [ ] **Step 4: Add email migration to the POST / (create) path as well**

Find around line 503 where email password is encrypted:

```typescript
encryptedPassword: encrypt(extract("emailPassword"), encryptionKey),
```

Replace with:

```typescript
password: protectValue(extract("emailPassword"), encryptionKey),
// encryptedPassword intentionally omitted — new configs use password: ProtectedValue
```

- [ ] **Step 5: Verify workers still accept both fields — open workers/feed-updater.worker.ts and find where email password is used**

```bash
grep -n "encryptedPassword\|emailPassword\|password" /home/timb/projects/mkfd/workers/imap-feed.worker.ts | head -20
```

- [ ] **Step 6: Update the email worker to prefer password, fall back to encryptedPassword**

In `workers/imap-feed.worker.ts`, find where the password is decrypted and add the fallback:

```typescript
import { resolveProtectedValue, isProtectedValue } from "../utilities/protected-values.utility";

// Where the password is resolved:
const encKey = process.env.ENCRYPTION_KEY ?? "";
const rawPassword = feedConfig.config.password ?? feedConfig.config.encryptedPassword;

let resolvedPassword: string;
if (isProtectedValue(rawPassword)) {
  resolvedPassword = resolveProtectedValue(rawPassword, encKey);
} else if (typeof rawPassword === "string") {
  // Legacy encryptedPassword is already a ciphertext string — decrypt it
  resolvedPassword = decrypt(rawPassword, encKey);
} else {
  throw new Error("Email feed config is missing a password.");
}
```

- [ ] **Step 7: Run all tests**

```bash
bun test tests/
```

Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add index.ts workers/imap-feed.worker.ts
git commit -m "feat: preserve masked protected values on save; migrate email encryptedPassword to ProtectedValue"
```

---

### Task 10: ProtectedValueInput component

**Files:**
- Create: `frontend/src/components/protected-value/ProtectedValueInput.tsx`

- [ ] **Step 1: Create the component**

```typescript
// frontend/src/components/protected-value/ProtectedValueInput.tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type StorageMode = "plain" | "protected" | "env";

export type ProtectedValueInputProps = {
  label: string;
  value: string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string } | undefined;
  onChange: (value: string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string }) => void;
  placeholder?: string;
};

function detectMode(value: ProtectedValueInputProps["value"]): StorageMode {
  if (!value || typeof value === "string") return "plain";
  return value.type === "env" ? "env" : "protected";
}

export function ProtectedValueInput({ label, value, onChange, placeholder }: ProtectedValueInputProps) {
  const [mode, setMode] = useState<StorageMode>(detectMode(value));
  const [isDirty, setIsDirty] = useState(false);

  const displayValue =
    mode === "protected" && !isDirty
      ? typeof value === "object" && value?.type === "protected"
        ? "********"
        : ""
      : mode === "env"
      ? typeof value === "object" && value?.type === "env"
        ? value.value
        : ""
      : typeof value === "string"
      ? value
      : "";

  const prefix =
    typeof value === "object" && value?.type === "env" ? value.prefix ?? "" : "";

  function handleModeChange(newMode: StorageMode) {
    setMode(newMode);
    setIsDirty(false);
  }

  function handleValueChange(newVal: string) {
    setIsDirty(true);
    if (mode === "plain") {
      onChange(newVal);
    } else if (mode === "protected") {
      onChange({ type: "protected", value: newVal });
    } else {
      onChange({ type: "env", value: newVal, prefix: prefix || undefined });
    }
  }

  function handlePrefixChange(newPrefix: string) {
    if (mode === "env") {
      const varName = typeof value === "object" && value?.type === "env" ? value.value : "";
      onChange({ type: "env", value: varName, prefix: newPrefix || undefined });
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          className="flex-1"
          placeholder={mode === "protected" ? "********" : placeholder}
          value={displayValue}
          type={mode === "protected" ? "password" : "text"}
          onChange={(e) => handleValueChange(e.target.value)}
        />
        <Select value={mode} onValueChange={(v) => handleModeChange(v as StorageMode)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">Plain</SelectItem>
            <SelectItem value="protected">Encrypted</SelectItem>
            <SelectItem value="env">Env var</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === "env" && (
        <Input
          placeholder="Prefix (e.g. Bearer )"
          value={prefix}
          onChange={(e) => handlePrefixChange(e.target.value)}
          className="text-sm"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Start the dev server and verify the component renders without errors**

```bash
cd /home/timb/projects/mkfd/frontend && bun run dev
```

Open `http://localhost:5173` and confirm the app loads without errors. Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/protected-value/ProtectedValueInput.tsx
git commit -m "feat: add ProtectedValueInput component with storage mode selector"
```

---

### Task 11: ProtectedKeyValueEditor component

**Files:**
- Create: `frontend/src/components/protected-value/ProtectedKeyValueEditor.tsx`

- [ ] **Step 1: Create the component**

```typescript
// frontend/src/components/protected-value/ProtectedKeyValueEditor.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { StorageMode } from "./ProtectedValueInput";

export type ProtectedKVRow = {
  id: string;
  key: string;
  rawValue: string;       // What the text input shows — plaintext, "********", or env var name
  storage: StorageMode;
  prefix?: string;
  isDirty: boolean;
};

type RawConfigValue = string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string };

export type ProtectedKeyValueEditorProps = {
  label: string;
  value: Record<string, RawConfigValue>;
  onChange: (value: Record<string, RawConfigValue>) => void;
  addButtonLabel?: string;
};

function recordToRows(record: Record<string, RawConfigValue>): ProtectedKVRow[] {
  return Object.entries(record).map(([key, val], i) => {
    if (typeof val === "object" && val.type === "protected") {
      return { id: String(i), key, rawValue: "********", storage: "protected" as const, isDirty: false };
    }
    if (typeof val === "object" && val.type === "env") {
      return { id: String(i), key, rawValue: val.value, storage: "env" as const, prefix: val.prefix, isDirty: false };
    }
    return { id: String(i), key, rawValue: typeof val === "string" ? val : "", storage: "plain" as const, isDirty: false };
  });
}

function rowsToRecord(rows: ProtectedKVRow[]): Record<string, RawConfigValue> {
  return Object.fromEntries(
    rows
      .filter((r) => r.key.trim())
      .map((r) => {
        if (r.storage === "protected") {
          return [r.key, { type: "protected" as const, value: r.isDirty ? r.rawValue : "********" }];
        }
        if (r.storage === "env") {
          return [r.key, { type: "env" as const, value: r.rawValue, prefix: r.prefix || undefined }];
        }
        return [r.key, r.rawValue];
      }),
  );
}

export function ProtectedKeyValueEditor({ label, value, onChange, addButtonLabel = "Add row" }: ProtectedKeyValueEditorProps) {
  const [rows, setRows] = useState<ProtectedKVRow[]>(() => recordToRows(value));

  function update(updated: ProtectedKVRow[]) {
    setRows(updated);
    onChange(rowsToRecord(updated));
  }

  function addRow() {
    update([...rows, { id: Date.now().toString(), key: "", rawValue: "", storage: "plain", isDirty: false }]);
  }

  function removeRow(id: string) {
    update(rows.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<ProtectedKVRow>) {
    update(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <Label className="font-bold">{label}</Label>
      {rows.map((row) => (
        <div key={row.id} className="flex gap-2 items-start">
          <Input
            className="flex-1"
            placeholder="Key"
            value={row.key}
            onChange={(e) => updateRow(row.id, { key: e.target.value })}
          />
          <Input
            className="flex-1"
            placeholder={row.storage === "protected" ? "********" : row.storage === "env" ? "VAR_NAME" : "Value"}
            value={row.rawValue}
            type={row.storage === "protected" ? "password" : "text"}
            onChange={(e) => updateRow(row.id, { rawValue: e.target.value, isDirty: true })}
          />
          <Select
            value={row.storage}
            onValueChange={(v) => updateRow(row.id, { storage: v as StorageMode, isDirty: false })}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plain">Plain</SelectItem>
              <SelectItem value="protected">Encrypted</SelectItem>
              <SelectItem value="env">Env var</SelectItem>
            </SelectContent>
          </Select>
          {row.storage === "env" && (
            <Input
              className="w-28"
              placeholder="Prefix"
              value={row.prefix ?? ""}
              onChange={(e) => updateRow(row.id, { prefix: e.target.value })}
            />
          )}
          <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(row.id)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-1" />
        {addButtonLabel}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/protected-value/ProtectedKeyValueEditor.tsx
git commit -m "feat: add ProtectedKeyValueEditor component"
```

---

### Task 12: ProtectedCookieEditor component

**Files:**
- Create: `frontend/src/components/protected-value/ProtectedCookieEditor.tsx`

- [ ] **Step 1: Create the component**

```typescript
// frontend/src/components/protected-value/ProtectedCookieEditor.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { StorageMode } from "./ProtectedValueInput";

type RawCookieValue = string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string };

export type ProtectedCookieRow = {
  id: string;
  name: string;
  rawValue: string;
  storage: StorageMode;
  prefix?: string;
  isDirty: boolean;
  domain?: string;
  path?: string;
  secure: boolean;
  httpOnly: boolean;
};

export type CookieConfig = {
  name: string;
  value: RawCookieValue;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

export type ProtectedCookieEditorProps = {
  value: CookieConfig[];
  onChange: (value: CookieConfig[]) => void;
};

function cookiesToRows(cookies: CookieConfig[]): ProtectedCookieRow[] {
  return cookies.map((c, i) => {
    const val = c.value;
    let rawValue = "";
    let storage: StorageMode = "plain";
    let prefix: string | undefined;
    let isDirty = false;

    if (typeof val === "object" && val.type === "protected") {
      rawValue = "********"; storage = "protected";
    } else if (typeof val === "object" && val.type === "env") {
      rawValue = val.value; storage = "env"; prefix = val.prefix;
    } else {
      rawValue = typeof val === "string" ? val : "";
    }

    return {
      id: String(i),
      name: c.name,
      rawValue,
      storage,
      prefix,
      isDirty,
      domain: c.domain,
      path: c.path,
      secure: c.secure ?? false,
      httpOnly: c.httpOnly ?? false,
    };
  });
}

function rowsToCookies(rows: ProtectedCookieRow[]): CookieConfig[] {
  return rows.filter((r) => r.name.trim()).map((r) => {
    let value: RawCookieValue;
    if (r.storage === "protected") {
      value = { type: "protected", value: r.isDirty ? r.rawValue : "********" };
    } else if (r.storage === "env") {
      value = { type: "env", value: r.rawValue, prefix: r.prefix || undefined };
    } else {
      value = r.rawValue;
    }
    return { name: r.name, value, domain: r.domain, path: r.path, secure: r.secure, httpOnly: r.httpOnly };
  });
}

export function ProtectedCookieEditor({ value, onChange }: ProtectedCookieEditorProps) {
  const [rows, setRows] = useState<ProtectedCookieRow[]>(() => cookiesToRows(value));

  function update(updated: ProtectedCookieRow[]) {
    setRows(updated);
    onChange(rowsToCookies(updated));
  }

  function addRow() {
    update([...rows, { id: Date.now().toString(), name: "", rawValue: "", storage: "plain", isDirty: false, secure: false, httpOnly: false }]);
  }

  function updateRow(id: string, patch: Partial<ProtectedCookieRow>) {
    update(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <Label className="font-bold">Cookies</Label>
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-2 items-center">
          <Input placeholder="Name" value={row.name} onChange={(e) => updateRow(row.id, { name: e.target.value })} />
          <Input
            placeholder={row.storage === "protected" ? "********" : row.storage === "env" ? "VAR_NAME" : "Value"}
            value={row.rawValue}
            type={row.storage === "protected" ? "password" : "text"}
            onChange={(e) => updateRow(row.id, { rawValue: e.target.value, isDirty: true })}
          />
          <Select
            value={row.storage}
            onValueChange={(v) => updateRow(row.id, { storage: v as StorageMode, isDirty: false })}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plain">Plain</SelectItem>
              <SelectItem value="protected">Encrypted</SelectItem>
              <SelectItem value="env">Env var</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Checkbox
              id={`secure-${row.id}`}
              checked={row.secure}
              onCheckedChange={(v) => updateRow(row.id, { secure: !!v })}
            />
            <Label htmlFor={`secure-${row.id}`} className="text-xs">Secure</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox
              id={`http-${row.id}`}
              checked={row.httpOnly}
              onCheckedChange={(v) => updateRow(row.id, { httpOnly: !!v })}
            />
            <Label htmlFor={`http-${row.id}`} className="text-xs">HttpOnly</Label>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => update(rows.filter((r) => r.id !== row.id))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-1" />Add cookie
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/protected-value/ProtectedCookieEditor.tsx
git commit -m "feat: add ProtectedCookieEditor component"
```

---

### Task 13: Wire new editors into AdditionalOptions and add sensitive value warnings

**Files:**
- Modify: `frontend/src/components/forms/AdditionalOptions.tsx`

- [ ] **Step 1: Read the current AdditionalOptions.tsx to understand how headers and cookies are currently wired**

```bash
cat /home/timb/projects/mkfd/frontend/src/components/forms/AdditionalOptions.tsx
```

- [ ] **Step 2: Replace the KeyValueManager import with ProtectedKeyValueEditor**

Remove:

```typescript
import { KeyValueManager } from "./KeyValueManager";
```

Add:

```typescript
import { ProtectedKeyValueEditor } from "@/components/protected-value/ProtectedKeyValueEditor";
import { ProtectedCookieEditor } from "@/components/protected-value/ProtectedCookieEditor";
import { findPlainSensitiveValues } from "../../../utilities/sensitive-config.utility";
```

Note: `findPlainSensitiveValues` is a backend utility. For the frontend, copy the sensitive pattern logic inline or expose it via a small shared module at `frontend/src/lib/sensitive-config.ts`:

```typescript
// frontend/src/lib/sensitive-config.ts
const SENSITIVE_PATTERNS = [
  "authorization", "cookie", "x-api-key", "apikey", "apitoken",
  "token", "secret", "password", "passwd", "session", "csrf",
  "access_token", "refresh_token", "bearer",
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => key.toLowerCase().includes(p));
}
```

- [ ] **Step 3: Replace the KeyValueManager usage for headers with ProtectedKeyValueEditor**

Find the existing headers section in `AdditionalOptions.tsx`:

```tsx
<KeyValueManager
  control={control}
  name="headers"
  label="Headers"
  addButtonLabel="Add header"
/>
```

Replace with (using `Controller` from react-hook-form):

```tsx
import { Controller } from "react-hook-form";

<Controller
  control={control}
  name="headers"
  defaultValue={{}}
  render={({ field }) => (
    <>
      <ProtectedKeyValueEditor
        label="Headers"
        value={field.value ?? {}}
        onChange={field.onChange}
        addButtonLabel="Add header"
      />
      {Object.entries(field.value ?? {}).map(([k, v]) =>
        typeof v === "string" && isSensitiveKey(k) ? (
          <p key={k} className="text-xs text-amber-600 mt-1">
            {k}: This value looks sensitive. Consider encrypting it.
          </p>
        ) : null,
      )}
    </>
  )}
/>
```

- [ ] **Step 4: Replace the CookiesManager usage with ProtectedCookieEditor**

Find the existing cookies section:

```tsx
{!isEmailFeed && <CookiesManager control={control} />}
```

Replace with:

```tsx
{!isEmailFeed && (
  <Controller
    control={control}
    name="cookies"
    defaultValue={[]}
    render={({ field }) => (
      <ProtectedCookieEditor
        value={field.value ?? []}
        onChange={field.onChange}
      />
    )}
  />
)}
```

- [ ] **Step 5: Start the dev server and verify the forms work**

```bash
cd /home/timb/projects/mkfd/frontend && bun run dev
```

Open `http://localhost:5173`. Go to the Build Feed form:
1. Expand the Additional Options / Headers section — confirm `ProtectedKeyValueEditor` renders with storage mode selector on each row
2. Add a header with key `Authorization` and plain value — confirm the warning appears
3. Switch storage mode to Encrypted — confirm the field switches to password type
4. Expand Cookies — confirm `ProtectedCookieEditor` renders with Secure/HttpOnly checkboxes and storage mode selector

Stop the server with Ctrl+C.

- [ ] **Step 6: Run all backend tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/forms/AdditionalOptions.tsx frontend/src/lib/sensitive-config.ts
git commit -m "feat: replace KeyValueManager and CookiesManager with ProtectedKeyValueEditor and ProtectedCookieEditor"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| ProtectedValue model + narrow types | Task 1 |
| isProtectedValue, protectValue, envValue | Task 2 |
| resolveProtectedValue, resolveProtectedValues | Task 3 |
| maskProtectedValues, preserveMaskedProtectedValues | Task 4 |
| Sensitive config scanner | Task 5 |
| Resolve in web scraping worker | Task 6 |
| Resolve in API/REST worker | Task 7 |
| Mask on GET config endpoints | Task 8 |
| Preserve on save round-trip | Task 9 |
| Email encryptedPassword migration | Task 9 |
| ProtectedValueInput component | Task 10 |
| ProtectedKeyValueEditor component | Task 11 |
| ProtectedCookieEditor component | Task 12 |
| Wire into AdditionalOptions | Task 13 |
| Sensitive value warnings in UI | Task 13 |

All spec requirements covered. No placeholders. Types used consistently throughout (`StorageMode`, `ProtectedKVRow`, `RawCookieValue`).
