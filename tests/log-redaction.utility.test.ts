// tests/log-redaction.utility.test.ts
//
// Test-author assumptions for slice p2-redacting-logger (see
// docs/tdd/p2-redacting-logger.md). Nothing here exists yet in production;
// this file specifies the contract the lead's implementation must satisfy.
//
//   - Module: utilities/log-redaction.utility.ts
//   - Entry point: `redact(value: unknown): unknown`, a pure function that
//     returns a redacted deep copy safe to pass to console.log/console.error.
//     It must accept both objects/arrays *and* bare strings (requirement 4
//     needs URL userinfo scrubbed even when the top-level value is a string,
//     not just when a string is nested inside an object).
//   - Marker convention: a redacted leaf becomes a *string* containing the
//     substring "redact" (case-insensitive) — e.g. "[REDACTED]", matching
//     the existing hand-rolled convention at routes/utils.ts:431. See
//     `isRedactionMarker` below. If the real implementation picks a
//     different marker shape, only that one helper needs to change; every
//     assertion in this file is written against the helper, not a literal
//     string, except where a test is specifically about marker mechanics.
//
// These are real design choices on this test author's part where the brief
// intentionally leaves room ("multiple conforming implementations should
// remain possible"). Only `isRedactionMarker` and the module import path
// should need to change if the lead's concrete design differs.

import { describe, it, expect } from "bun:test";
import { redact } from "../utilities/log-redaction.utility";

function isRedactionMarker(value: unknown): boolean {
  return typeof value === "string" && /redact/i.test(value);
}

// Small typed-cast helpers so the tests below never need `any`: `redact`
// returns `unknown`, and these narrow it back to shapes we control.
function rec(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
function arr(value: unknown): unknown[] {
  return value as unknown[];
}
function str(value: unknown): string {
  return value as string;
}

// ---------------------------------------------------------------------------
// Requirement 1: shape-preserving redaction with retained diagnostic value
// ---------------------------------------------------------------------------

describe("redact — shape preservation and diagnostic value (req 1)", () => {
  it("keeps non-sensitive fields intact and replaces the sensitive one", () => {
    const input = { host: "example.com", status: 200, password: "hunter2" };
    const result = rec(redact(input));

    expect(result.host).toBe("example.com");
    expect(result.status).toBe(200);
    expect(isRedactionMarker(result.password)).toBe(true);
  });

  it("preserves the top-level key set — redaction hides values, not structure", () => {
    const input = { host: "example.com", feedId: "abc-123", apiKey: "sk-live-xyz" };
    const result = rec(redact(input));

    expect(Object.keys(result).sort()).toEqual(Object.keys(input).sort());
  });

  it("a redacted request-like object is still useful for debugging a failed preview", () => {
    const input = {
      method: "GET",
      url: "https://api.example.com/v1/items",
      status: 502,
      headers: { Authorization: "Bearer sk-live-abcdef", Accept: "application/json" },
    };
    const result = rec(redact(input));
    const headers = rec(result.headers);

    // An operator must still be able to tell which host, method and status failed.
    expect(result.method).toBe("GET");
    expect(result.url).toBe("https://api.example.com/v1/items");
    expect(result.status).toBe(502);
    expect(headers.Accept).toBe("application/json");
    // But not the credential that got it there.
    expect(JSON.stringify(result)).not.toContain("sk-live-abcdef");
  });

  it("does not simply collapse everything to an empty object", () => {
    const input = { a: 1, b: "two", password: "secret" };
    const result = rec(redact(input));
    expect(Object.keys(result).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Requirement 2: structural + recursive redaction, not a regex over a
// finished JSON string
// ---------------------------------------------------------------------------

describe("redact — structural recursion, not string-level regex (req 2)", () => {
  it("reaches a secret nested arbitrarily deep through objects and arrays", () => {
    const input = {
      config: {
        proxies: [
          { name: "primary", auth: { username: "svc", password: "deep-secret-1" } },
          { name: "backup", auth: { username: "svc2", password: "deep-secret-2" } },
        ],
      },
    };
    const result = rec(redact(input));
    const proxies = arr(rec(result.config).proxies);
    const auth0 = rec(rec(proxies[0]).auth);
    const auth1 = rec(rec(proxies[1]).auth);

    expect(auth0.username).toBe("svc");
    expect(isRedactionMarker(auth0.password)).toBe(true);
    expect(auth1.username).toBe("svc2");
    expect(isRedactionMarker(auth1.password)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("deep-secret-1");
    expect(JSON.stringify(result)).not.toContain("deep-secret-2");
  });

  it("redacts the real axios-shaped defect: preview config with nested headers and proxy", () => {
    // Mirrors the actual shape logged at preview-generator.utility.ts:238.
    const axiosConfig = {
      method: "POST",
      url: "https://api.example.com/hook",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer live-token-999",
        Cookie: "session=abc; other=1",
      },
      params: { page: 1 },
      proxy: { host: "10.0.0.5", port: 8080, auth: { username: "px", password: "px-secret" } },
      timeout: 60000,
      maxRedirects: 0,
    };
    const result = rec(redact(axiosConfig));
    const headers = rec(result.headers);
    const proxy = rec(result.proxy);

    expect(result.method).toBe("POST");
    expect(result.url).toBe("https://api.example.com/hook");
    expect(headers.Accept).toBe("application/json");
    expect(proxy.host).toBe("10.0.0.5");
    expect(proxy.port).toBe(8080);
    expect(result.params).toEqual({ page: 1 });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("live-token-999");
    expect(serialized).not.toContain("px-secret");
    expect(serialized).not.toContain("session=abc");
  });

  it("only touches the actual sensitive key, not decoy text that merely mentions it", () => {
    // A naive "regex over JSON.stringify(...)" redactor keyed on
    // `"password":"..."` would also mangle (or, depending on match order,
    // miss) the pattern sitting inside this unrelated string value. A
    // structural, key-driven redactor never even looks at `description`'s
    // characters — it only inspects real object keys.
    const input = {
      description: 'debug note: saw literal text "password":"not-a-real-secret" in a vendor log sample',
      password: "REAL_SECRET_VALUE",
    };
    const result = rec(redact(input));

    expect(result.description).toBe(input.description);
    expect(result.password).not.toBe("REAL_SECRET_VALUE");
    expect(JSON.stringify(result)).not.toContain("REAL_SECRET_VALUE");
  });
});

// ---------------------------------------------------------------------------
// Requirement 3: name matching — case-insensitive, common variants, header names
// ---------------------------------------------------------------------------

describe("redact — sensitive field name matching (req 3)", () => {
  const sensitiveKeys = [
    "password",
    "passkey",
    "token",
    "secret",
    "apiKey",
    "api_key",
    "api-key",
    "encryptionKey",
    "cookieSecret",
    "cookie_secret",
    "authorization",
    "cookie",
    "set-cookie",
  ];

  for (const key of sensitiveKeys) {
    it(`redacts field named "${key}"`, () => {
      const input: Record<string, string> = { [key]: "value-that-must-not-leak", host: "example.com" };
      const result = rec(redact(input));
      expect(isRedactionMarker(result[key])).toBe(true);
      expect(result.host).toBe("example.com");
    });
  }

  const caseVariants = ["PASSWORD", "Password", "PassWord", "AUTHORIZATION", "Authorization"];
  for (const key of caseVariants) {
    it(`matches case variant "${key}"`, () => {
      const input: Record<string, string> = { [key]: "value-that-must-not-leak" };
      const result = rec(redact(input));
      expect(isRedactionMarker(result[key])).toBe(true);
    });
  }

  const headerCapitalizations = ["Cookie", "cookie", "COOKIE", "Set-Cookie", "SET-COOKIE", "set-cookie"];
  for (const key of headerCapitalizations) {
    it(`matches HTTP header capitalization "${key}"`, () => {
      const input = { headers: { [key]: "header-value-that-must-not-leak" } as Record<string, string> };
      const result = rec(redact(input));
      const headers = rec(result.headers);
      expect(isRedactionMarker(headers[key])).toBe(true);
    });
  }

  it("redacts a proxy credential field", () => {
    const input = { proxy: { host: "10.0.0.5", auth: { password: "proxy-secret" } } };
    const result = rec(redact(input));
    const proxy = rec(result.proxy);
    expect(proxy.host).toBe("10.0.0.5");
    expect(isRedactionMarker(rec(proxy.auth).password)).toBe(true);
  });

  it("does not flag ordinary, non-sensitive field names", () => {
    const input: Record<string, unknown> = {
      host: "example.com",
      baseUrl: "https://example.com",
      method: "GET",
      status: 200,
      accept: "application/json",
      feedId: "abc",
    };
    const result = rec(redact(input));
    for (const key of Object.keys(input)) {
      expect(result[key]).toBe(input[key]);
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 4: credentials embedded inside string values (URL userinfo)
// ---------------------------------------------------------------------------

describe("redact — credentials embedded in strings (req 4)", () => {
  it("strips userinfo from a bare URL string", () => {
    const result = str(redact("https://user:pass@host.example.com/path"));
    expect(result).not.toContain("user:pass@");
    expect(result).toContain("host.example.com/path");
  });

  it("strips userinfo from a URL nested under a non-sensitive field name", () => {
    // The field name "proxyUrl" does not match any sensitive-name pattern —
    // this must be caught by scanning the string value itself, not the key.
    const input = { proxyUrl: "http://proxyuser:proxypass@10.0.0.5:8080" };
    const result = rec(redact(input));
    expect(str(result.proxyUrl)).not.toContain("proxyuser:proxypass@");
    expect(str(result.proxyUrl)).toContain("10.0.0.5:8080");
  });

  it("strips userinfo from a URL embedded inside a longer message", () => {
    const input = {
      message: "Failed to fetch https://u:p@internal-host/x: ECONNREFUSED",
    };
    const result = rec(redact(input));
    expect(str(result.message)).not.toContain("u:p@");
    expect(str(result.message)).toContain("ECONNREFUSED");
    expect(str(result.message)).toContain("internal-host/x");
  });

  it("does not mangle a plain email address (no colon before the @)", () => {
    const input = { contact: "Reach us at ops@example.com for help." };
    const result = rec(redact(input));
    expect(result.contact).toBe(input.contact);
  });

  it("leaves a URL with no userinfo untouched", () => {
    const input = { url: "https://example.com/path?x=1" };
    const result = rec(redact(input));
    expect(result.url).toBe(input.url);
  });
});

// ---------------------------------------------------------------------------
// Requirement 5: protected-value shapes and resolved envelopes never leak
// ---------------------------------------------------------------------------

describe("redact — protected value and AES-GCM envelope shapes (req 5)", () => {
  it("redacts a { type: 'protected', value } shape", () => {
    const input = { type: "protected", value: "plaintext-that-should-never-appear" };
    const result = redact(input);
    expect(JSON.stringify(result)).not.toContain("plaintext-that-should-never-appear");
  });

  it("redacts a { type: 'protected', value } shape nested under a config field", () => {
    const input = {
      headers: {
        Authorization: { type: "protected", value: "never-log-this-plaintext" },
      },
    };
    const result = redact(input);
    expect(JSON.stringify(result)).not.toContain("never-log-this-plaintext");
  });

  it("redacts a resolved AES-256-GCM envelope object (v/iv/tag/ct)", () => {
    const envelope = {
      v: 1,
      iv: "AAAAAAAAAAAAAAAAAAAA",
      tag: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      ct: "very-secret-ciphertext-payload-content",
    };
    const result = redact(envelope);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("very-secret-ciphertext-payload-content");
    expect(serialized).not.toContain("AAAAAAAAAAAAAAAAAAAA");
    expect(serialized).not.toContain("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  });

  it("redacts a resolved envelope nested inside a larger config object", () => {
    const input = {
      feedId: "abc",
      storedSecret: {
        v: 1,
        iv: "CCCCCCCCCCCCCCCCCCCC",
        tag: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        ct: "another-secret-ciphertext-blob",
      },
    };
    const result = rec(redact(input));
    expect(result.feedId).toBe("abc");
    expect(JSON.stringify(result)).not.toContain("another-secret-ciphertext-blob");
  });
});

// ---------------------------------------------------------------------------
// Requirement 7: total — never throws, bounded output, no infinite recursion
// ---------------------------------------------------------------------------

describe("redact — total function, adversarial inputs (req 7)", () => {
  it("handles null and undefined without throwing", () => {
    expect(() => redact(null)).not.toThrow();
    expect(() => redact(undefined)).not.toThrow();
  });

  it("handles primitives without throwing", () => {
    expect(() => redact(42)).not.toThrow();
    expect(() => redact(true)).not.toThrow();
    expect(() => redact("")).not.toThrow();
  });

  it("handles a circular reference without throwing and without leaving a cycle behind", () => {
    type SelfRef = { host: string; password: string; self?: unknown };
    const input: SelfRef = { host: "example.com", password: "secret" };
    input.self = input;

    let result: unknown;
    expect(() => {
      result = redact(input);
    }).not.toThrow();

    const redacted = rec(result);
    expect(redacted.host).toBe("example.com");
    expect(isRedactionMarker(redacted.password)).toBe(true);
    // If a cycle survived, JSON.stringify would throw.
    expect(() => JSON.stringify(redacted)).not.toThrow();
  });

  it("handles a circular reference reachable through an array", () => {
    type ArrRef = { items: unknown[] };
    const input: ArrRef = { items: [{ name: "a" }] };
    input.items.push(input);

    expect(() => redact(input)).not.toThrow();
  });

  it("preserves an Error's message and does not throw, including with a cause", () => {
    const cause = new Error("root cause: connection refused");
    const error = new Error("preview generation failed", { cause });
    Object.assign(error, { token: "leaked-if-not-redacted" });

    let result: unknown;
    expect(() => {
      result = redact(error);
    }).not.toThrow();

    const serialized = JSON.stringify(result);
    expect(serialized).toContain("preview generation failed");
    expect(serialized).not.toContain("leaked-if-not-redacted");
  });

  it("handles a Date without throwing and keeps it recognizable", () => {
    const date = new Date("2026-01-15T00:00:00.000Z");
    let result: unknown;
    expect(() => {
      result = redact(date);
    }).not.toThrow();
    expect(JSON.stringify(result)).toContain("2026-01-15");
  });

  it("handles a Map without throwing, preserving non-sensitive entries and redacting sensitive ones", () => {
    const map = new Map<string, string>([
      ["host", "example.com"],
      ["password", "hunter2"],
    ]);
    let result: unknown;
    expect(() => {
      result = redact(map);
    }).not.toThrow();
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("example.com");
    expect(serialized).not.toContain("hunter2");
  });

  it("handles a Set without throwing", () => {
    const set = new Set(["a", "b", "c"]);
    expect(() => redact(set)).not.toThrow();
  });

  it("handles a function value on an object without throwing", () => {
    const input = { host: "example.com", onDone: () => {} };
    expect(() => redact(input)).not.toThrow();
  });

  it("does not throw and terminates on a 10-deep nested object carrying a secret at the bottom", () => {
    let node: Record<string, unknown> = { password: "buried-secret" };
    for (let i = 0; i < 10; i++) node = { child: node };

    let result: unknown;
    expect(() => {
      result = redact(node);
    }).not.toThrow();

    let cursor = rec(result);
    for (let i = 0; i < 10; i++) cursor = rec(cursor.child);
    expect(isRedactionMarker(cursor.password)).toBe(true);
  });

  it("does not throw or stack-overflow on a very deep (thousands-level) nested chain", () => {
    const depth = 5000;
    let node: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < depth; i++) node = { child: node };

    expect(() => redact(node)).not.toThrow();
  }, 10000);

  it("does not throw and bounds total output size for a very large array (10,000 entries)", () => {
    const bigArray = Array.from({ length: 10_000 }, (_, i) => ({
      index: i,
      password: `secret-${i}`,
      note: "x".repeat(200),
    }));

    let result: unknown;
    expect(() => {
      result = redact(bigArray);
    }).not.toThrow();

    const serialized = JSON.stringify(result);
    // Unbounded passthrough of 10,000 * ~230-byte entries would be well over
    // 2MB. A total logger must cap output rather than reproduce it all.
    expect(serialized.length).toBeLessThan(500_000);
    expect(serialized).not.toContain("secret-0");
  }, 10000);
});

// ---------------------------------------------------------------------------
// Anti-bypass: redact() must not mutate the caller's object
// ---------------------------------------------------------------------------

describe("redact — does not mutate the input", () => {
  it("leaves the original object and its nested values unchanged", () => {
    const input = {
      password: "hunter2",
      nested: { token: "abc-123" },
      list: [{ secret: "s1" }],
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    redact(input);

    expect(input).toEqual(snapshot);
  });

  it("returns a different object reference than the input", () => {
    const input = { password: "hunter2" };
    const result = redact(input);
    expect(result).not.toBe(input);
  });
});
