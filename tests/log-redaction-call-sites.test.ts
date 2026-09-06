// tests/log-redaction-call-sites.test.ts
//
// Integration coverage for requirement 6 of slice p2-redacting-logger: the
// two known-defective call sites must stop logging live secrets, without
// being fixed by deleting the log line outright.
//
//   1. utilities/preview-generator.utility.ts:238 — logs the resolved
//      axios request config, including live Authorization headers.
//   2. workers/imap-feed.worker.ts:153 — logs the raw encryptionKey
//      variable when the guard above it rejects it.
//
// These assert on *actually emitted output* (via spying on console.log /
// console.error and rendering the captured arguments the same way a
// terminal would, with Bun.inspect), not on the shape of the call — a
// secret one level deep inside a logged object is exactly what the current
// defect misses, so the assertion has to look at the rendered text.
//
// Network note: the preview-generator case must reach the real axios call
// (the leak happens before that call, but the surrounding code has to run
// to completion without hanging the suite). It targets 127.0.0.1 on a high
// port nothing listens on, so the TCP connection is refused immediately.
// This is loopback-only, not a live third-party service.

import { describe, it, expect, spyOn } from "bun:test";
import { generatePreview } from "../utilities/preview-generator.utility";

function renderCalls(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => Bun.inspect(call)).join("\n");
}

const UNREACHABLE_LOOPBACK_URL = "http://127.0.0.1:65530";

describe("preview-generator: resolved credentials must not be logged (req 6)", () => {
  it("does not log a live Authorization header value", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const secret = "sk-super-secret-token-value";

    try {
      const feedConfig = {
        feedId: "preview",
        feedType: "api",
        allowPrivateFetches: true,
        config: { baseUrl: UNREACHABLE_LOOPBACK_URL, route: "/x", method: "GET" },
        headers: { Authorization: `Bearer ${secret}` },
      };

      await expect(generatePreview(feedConfig)).rejects.toThrow();

      const rendered = renderCalls(logSpy) + renderCalls(errorSpy);
      expect(rendered).not.toContain(secret);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }, 15000);

  it("does not log a cookie value carried into the request headers", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const secretCookie = "session-cookie-secret-abcdef";

    try {
      const feedConfig = {
        feedId: "preview",
        feedType: "api",
        allowPrivateFetches: true,
        config: { baseUrl: UNREACHABLE_LOOPBACK_URL, route: "/x", method: "GET" },
        cookies: [{ name: "session", value: secretCookie }],
      };

      await expect(generatePreview(feedConfig)).rejects.toThrow();

      const rendered = renderCalls(logSpy) + renderCalls(errorSpy);
      expect(rendered).not.toContain(secretCookie);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }, 15000);

  it("does not log an apiSpecificHeaders credential", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const secret = "x-api-key-secret-value-999";

    try {
      const feedConfig = {
        feedId: "preview",
        feedType: "rest",
        allowPrivateFetches: true,
        config: {
          baseUrl: UNREACHABLE_LOOPBACK_URL,
          route: "/x",
          method: "GET",
          apiSpecificHeaders: { "X-Api-Key": secret },
        },
      };

      await expect(generatePreview(feedConfig)).rejects.toThrow();

      const rendered = renderCalls(logSpy) + renderCalls(errorSpy);
      expect(rendered).not.toContain(secret);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }, 15000);

  it("does not delete the diagnostic entirely — the request's method and host are still logged", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const feedConfig = {
        feedId: "preview",
        feedType: "api",
        allowPrivateFetches: true,
        config: { baseUrl: UNREACHABLE_LOOPBACK_URL, route: "/x", method: "GET" },
        headers: { Authorization: "Bearer irrelevant-for-this-assertion" },
      };

      await expect(generatePreview(feedConfig)).rejects.toThrow();

      const rendered = renderCalls(logSpy) + renderCalls(errorSpy);
      // A logger that satisfies req 6 by deleting the log line, rather than
      // redacting it, would make this fail: there would be nothing here
      // naming the method or the target host at all.
      expect(rendered).toContain("GET");
      expect(rendered).toContain("127.0.0.1");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }, 15000);
});

// Loaded via a computed specifier, deliberately not a literal import path:
// workers/imap-feed.worker.ts is declared as a `fallow` `entry` point (see
// .fallowrc.json and tests/fallow-static-analysis-gate.test.ts) precisely
// *because* nothing else in the source tree imports it — it is loaded only
// via `new Worker(...)` at runtime. A literal `import("../workers/...")`
// here would hand fallow's dead-code graph a real edge into an otherwise
// deliberately entry-only file and falsify that other, unrelated locked
// test. This test still exercises the real module; it just doesn't do so
// in a way a static import-graph tool can mistake for production usage.
const IMAP_WORKER_MODULE_PATH = ["..", "workers", "imap-feed.worker"].join("/");

describe("imap-feed.worker: invalid encryption key must not log key material (req 6)", () => {
  it("does not log secret data carried in a non-string encryptionKey", async () => {
    await import(IMAP_WORKER_MODULE_PATH);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const secret = "sk-imap-key-material-should-not-leak";

    try {
      (self as unknown as { onmessage: (m: { data: unknown }) => void }).onmessage({
        data: {
          command: "start",
          encryptionKey: { unexpectedShape: secret },
          config: { feedId: "feed-1" },
        },
      });

      expect(errorSpy).toHaveBeenCalled();
      const rendered = renderCalls(errorSpy);
      expect(rendered).not.toContain(secret);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not delete the diagnostic entirely — the failure is still named", async () => {
    await import(IMAP_WORKER_MODULE_PATH);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      (self as unknown as { onmessage: (m: { data: unknown }) => void }).onmessage({
        data: {
          command: "start",
          encryptionKey: null,
          config: { feedId: "feed-2" },
        },
      });

      expect(errorSpy).toHaveBeenCalled();
      const rendered = renderCalls(errorSpy);
      expect(rendered.toLowerCase()).toContain("encryption key");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("still reports the error status to the caller when the key is invalid", async () => {
    await import(IMAP_WORKER_MODULE_PATH);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const postSpy = spyOn(
      self as unknown as { postMessage: (m: unknown) => void },
      "postMessage",
    ).mockImplementation(() => {});

    try {
      (self as unknown as { onmessage: (m: { data: unknown }) => void }).onmessage({
        data: {
          command: "start",
          encryptionKey: undefined,
          config: { feedId: "feed-3" },
        },
      });

      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "error", error: "Invalid encryption key" }),
      );
    } finally {
      errorSpy.mockRestore();
      postSpy.mockRestore();
    }
  });
});
