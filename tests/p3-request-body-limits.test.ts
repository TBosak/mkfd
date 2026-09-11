// TDD slice: p3-request-body-limits.
//
// These tests exercise the real mkfd server over loopback TCP. Body-limit
// placement is part of the contract: the boundary must protect both the
// passkey parser and the independently authenticated webhook parser, and it
// must preserve streamed request bytes for the downstream parser.
//
// Requirements covered (see docs/tdd/p3-request-body-limits.md):
//   1-4  fallback, state-changing, webhook, and passkey caps
//   5    exact boundary accepted; one byte over rejected
//   6-7  declared-length preflight, chunked byte counting, and replay
//   8    UTF-8 byte counting
//   9    malformed/ambiguous Content-Length rejection
//   10   stable, sanitized 413 response
//   11-12 anonymous ingress/static/readiness and authenticated regressions

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { request as httpRequest, type ClientRequest } from "node:http";
import { createConnection } from "node:net";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteFeedConfig, writeFeedConfig } from "../utilities/config-manager.utility";
import { hashWebhookToken } from "../utilities/webhook-feed.utility";
import type { WebhookFeedConfig } from "../models/feed-config.model";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

const LIMITS = {
  fallback: 1 * 1024 * 1024,
  stateChanging: 256 * 1024,
  webhook: 64 * 1024,
  passkey: 8 * 1024,
} as const;

const BASE_SECRETS = {
  PASSKEY: "p3-request-body-limits-passkey",
  COOKIE_SECRET: "p3-request-body-limits-cookie-secret-32-chars",
  ENCRYPTION_KEY: "p3-request-body-limits-encryption-key-32-chars",
};

const FEED_ID = "p3-request-body-limits-webhook-feed";
const SLUG = "p3-request-body-limits-webhook-slug";
const WEBHOOK_TOKEN = "mkfd_wh_p3_request_body_limits_test_token";
const BODY_MARKER = "p3-request-body-limits-secret-must-not-echo";
const DB_REL_DIR = `./.tdd-state/_p3-request-body-limits-db-${process.pid}`;
const DB_REL_PATH = `${DB_REL_DIR}/runtime.db`;
const EVENT_PATH = resolve(REPO_ROOT, "feed-state/webhooks", `${FEED_ID}.jsonl`);

type PersistedWebhookRow = {
  external_id: string | null;
  title: string;
  description: string | null;
};

function readPersistedWebhookRows(externalId: string): PersistedWebhookRow[] {
  const sqlite = new Database(resolve(REPO_ROOT, DB_REL_PATH), { readonly: true });
  try {
    return sqlite
      .query(`
          SELECT external_id, title, description
          FROM webhook_feed_events
          WHERE feed_id = ? AND external_id = ?
        `)
      .all(FEED_ID, externalId) as PersistedWebhookRow[];
  } finally {
    sqlite.close();
  }
}

type BodyInput = string | Uint8Array;

interface RawResponse {
  status: number;
  body: string;
}

function utf8Bytes(value: string | Uint8Array): number {
  return typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength;
}

function asciiBodyOfByteLength(targetBytes: number, prefix: string): string {
  const prefixBytes = utf8Bytes(prefix);
  if (prefixBytes > targetBytes) {
    throw new Error(`Prefix is already ${prefixBytes} bytes; target is ${targetBytes}`);
  }
  return prefix + "x".repeat(targetBytes - prefixBytes);
}

/**
 * Produces valid JSON at an exact encoded byte length. The padding value is
 * deliberately allowed to be multi-byte UTF-8 so the test can distinguish
 * byte accounting from JavaScript string-length accounting.
 */
function jsonBodyOfByteLength(
  targetBytes: number,
  fields: Record<string, unknown>,
  fill = "a",
): string {
  const empty = JSON.stringify({ ...fields, padding: "" });
  const emptyBytes = utf8Bytes(empty);
  if (emptyBytes >= targetBytes) {
    throw new Error(`JSON fixture overhead is ${emptyBytes} bytes; target is ${targetBytes}`);
  }

  const unitBytes = utf8Bytes(JSON.stringify({ ...fields, padding: fill })) - emptyBytes;
  if (unitBytes < 1) throw new Error("JSON padding character did not add bytes");

  let fillCount = Math.floor((targetBytes - emptyBytes) / unitBytes);
  while (fillCount >= 0) {
    const padding = fill.repeat(fillCount);
    const candidate = JSON.stringify({ ...fields, padding });
    const remaining = targetBytes - utf8Bytes(candidate);
    if (remaining >= 0) {
      const withAsciiTail = JSON.stringify({
        ...fields,
        padding: `${padding}${"a".repeat(remaining)}`,
      });
      if (utf8Bytes(withAsciiTail) === targetBytes) return withAsciiTail;
    }
    fillCount -= 1;
  }

  throw new Error(`Could not construct a JSON body of exactly ${targetBytes} bytes`);
}

function passkeyFormOfByteLength(targetBytes: number, paddingPrefix = ""): string {
  const prefix =
    `passkey=${encodeURIComponent(BASE_SECRETS.PASSKEY)}` +
    `&padding=${encodeURIComponent(paddingPrefix)}`;
  return asciiBodyOfByteLength(targetBytes, prefix);
}

async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      await response.body?.cancel();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
  }
  throw new Error(`mkfd server did not become ready at ${url}: ${String(lastError)}`);
}

async function spawnServer(): Promise<Subprocess> {
  const proc = Bun.spawn([process.execPath, "index.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...BASE_SECRETS,
      RUNTIME_DB_PATH: DB_REL_PATH,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitForServer(`${BASE_URL}/passkey`);
  return proc;
}

async function stopServer(proc: Subprocess | undefined): Promise<void> {
  if (!proc) return;
  proc.kill();
  await proc.exited;
}

function sessionCookiePair(response: Response): string {
  const cookies = response.headers
    .getSetCookie()
    .filter((entry) => entry.toLowerCase().startsWith("session="));
  if (cookies.length === 0) throw new Error("Login response did not set a session cookie");
  return cookies[cookies.length - 1].split(";")[0].trim();
}

async function login(): Promise<string> {
  const response = await fetch(`${BASE_URL}/passkey`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `passkey=${encodeURIComponent(BASE_SECRETS.PASSKEY)}`,
  });
  const cookie = sessionCookiePair(response);
  const responseBody = await response.text();
  if (response.status !== 302 || response.headers.get("location") !== "/public/") {
    throw new Error(`Fixture login failed: ${response.status} ${responseBody}`);
  }
  return cookie;
}

function requestWithDeclaredLength(options: {
  method: string;
  path: string;
  body: BodyInput;
  headers?: Record<string, string>;
}): Promise<RawResponse> {
  const body = typeof options.body === "string" ? Buffer.from(options.body, "utf8") : Buffer.from(options.body);
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: PORT,
        path: options.path,
        method: options.method,
        headers: {
          connection: "close",
          ...options.headers,
          "content-length": String(body.byteLength),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolvePromise({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function requestChunked(options: {
  method: string;
  path: string;
  chunks: Uint8Array[];
  headers?: Record<string, string>;
}): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: PORT,
        path: options.path,
        method: options.method,
        headers: {
          connection: "close",
          "transfer-encoding": "chunked",
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolvePromise({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    for (const chunk of options.chunks) request.write(Buffer.from(chunk));
    request.end();
  });
}

interface OpenRequest {
  response: Promise<RawResponse>;
  close: () => void;
}

/**
 * Opens a raw HTTP request and deliberately leaves its upload unfinished.
 * The response promise resolves as soon as a complete response body arrives;
 * callers decide when to destroy the still-open connection.
 */
function openHeadersOnlyRequest(requestText: string): OpenRequest {
  const socket = createConnection({ host: "127.0.0.1", port: PORT });
  const chunks: Buffer[] = [];
  let settled = false;
  let resolveResponse!: (response: RawResponse) => void;
  let rejectResponse!: (error: unknown) => void;

  const response = new Promise<RawResponse>((resolvePromise, reject) => {
    resolveResponse = resolvePromise;
    rejectResponse = reject;
  });

  const parseResponse = (): RawResponse | null => {
    const raw = Buffer.concat(chunks);
    const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) return null;
    const headerText = raw.subarray(0, headerEnd).toString("latin1");
    const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/i.exec(headerText);
    if (!statusMatch) return null;
    const bodyStart = headerEnd + 4;
    const lengthMatch = /(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(headerText);
    if (lengthMatch && raw.byteLength < bodyStart + Number(lengthMatch[1])) return null;
    return {
      status: Number(statusMatch[1]),
      body: raw.subarray(bodyStart, lengthMatch ? bodyStart + Number(lengthMatch[1]) : undefined).toString("utf8"),
    };
  };

  const settle = (parsed?: RawResponse, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (error) rejectResponse(error);
    else if (parsed) resolveResponse(parsed);
    else rejectResponse(new Error("Open HTTP request closed without a complete response"));
  };

  socket.on("connect", () => socket.write(requestText));
  socket.on("data", (chunk) => {
    chunks.push(Buffer.from(chunk));
    const parsed = parseResponse();
    if (parsed) settle(parsed);
  });
  socket.on("end", () => settle(parseResponse() ?? undefined));
  socket.on("close", () => settle(parseResponse() ?? undefined));
  socket.on("error", (error) => {
    const parsed = parseResponse();
    if (parsed) settle(parsed);
    else settle(undefined, error);
  });

  return { response, close: () => socket.destroy() };
}

/** Opens a chunked request, writes selected chunks, and intentionally omits the terminating zero chunk. */
function openChunkedRequest(options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
}): {
  response: Promise<RawResponse>;
  write: (chunk: Uint8Array) => void;
  writableEnded: () => boolean;
  close: () => void;
} {
  let request!: ClientRequest;
  const response = new Promise<RawResponse>((resolvePromise, reject) => {
    request = httpRequest(
      {
        host: "127.0.0.1",
        port: PORT,
        path: options.path,
        method: options.method,
        headers: {
          connection: "keep-alive",
          "transfer-encoding": "chunked",
          ...options.headers,
        },
      },
      (serverResponse) => {
        const chunks: Buffer[] = [];
        serverResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
        serverResponse.on("end", () => {
          resolvePromise({
            status: serverResponse.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        serverResponse.on("error", reject);
      },
    );
    request.on("error", reject);
  });

  return {
    response,
    write: (chunk) => request.write(Buffer.from(chunk)),
    writableEnded: () => request.writableEnded,
    close: () => request.destroy(),
  };
}

async function awaitResponseWithin<T>(response: Promise<T>, description: string, timeoutMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${description} did not arrive while the upload remained open`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Sends exact request bytes, including invalid framing headers, over TCP. */
function rawTcpRequest(requestText: string): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: PORT });
    const chunks: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const parseResponse = (): RawResponse | null => {
      const raw = Buffer.concat(chunks);
      const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEnd < 0) return null;
      const headerText = raw.subarray(0, headerEnd).toString("latin1");
      const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/i.exec(headerText);
      if (!statusMatch) return null;
      const bodyStart = headerEnd + 4;
      const lengthMatch = /(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(headerText);
      if (lengthMatch && raw.byteLength < bodyStart + Number(lengthMatch[1])) return null;
      return {
        status: Number(statusMatch[1]),
        body: raw.subarray(bodyStart, lengthMatch ? bodyStart + Number(lengthMatch[1]) : undefined).toString("utf8"),
      };
    };

    const settle = (result?: RawResponse, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else if (result) resolvePromise(result);
      else reject(new Error("Raw HTTP connection closed without a complete response"));
    };

    socket.on("connect", () => socket.write(requestText));
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      const result = parseResponse();
      if (result) settle(result);
    });
    socket.on("end", () => settle(parseResponse() ?? undefined));
    socket.on("close", () => settle(parseResponse() ?? undefined));
    socket.on("error", (error) => {
      const result = parseResponse();
      if (result) settle(result);
      else settle(undefined, error);
    });
    timer = setTimeout(() => settle(undefined, new Error("Raw HTTP request timed out")), 5_000);
  });
}

function chunksFromBody(body: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(body);
  const sizes = [1, 2, 5, 13, 29, 61];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.byteLength) {
    const size = sizes[index % sizes.length];
    chunks.push(bytes.subarray(offset, Math.min(offset + size, bytes.byteLength)));
    offset += size;
    index += 1;
  }
  return chunks;
}

async function expectPayloadTooLarge(response: Response | RawResponse, marker?: string): Promise<void> {
  const body = await (response instanceof Response ? response.text() : Promise.resolve(response.body));
  expect(response.status, `oversized request must be rejected with HTTP 413; response was ${body}`).toBe(413);
  expect(body, "413 response must identify a payload/body size violation").toMatch(
    /(?:payload|request|body|entity).*(?:too\s+large|exceed|limit)|(?:too\s+large|exceed|limit).*(?:payload|request|body|entity)/i,
  );
  expect(body, "413 response must not leak submitted body fragments").not.toContain(BODY_MARKER);
  if (marker) expect(body, "413 response must not leak the caller marker").not.toContain(marker);
  expect(body, "413 must be a size response, not a parser-validation response").not.toMatch(
    /unexpected|invalid\s+(?:json|request\s+body)|webhook\s+payload/i,
  );
}

function webhookHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${WEBHOOK_TOKEN}`,
    "content-type": "application/json",
  };
}

function invalidLengthRequest(lengthHeader: string, body = `{"marker":"${BODY_MARKER}"}`): string {
  return [
    `POST /webhook-feeds/${SLUG} HTTP/1.1`,
    `Host: 127.0.0.1:${PORT}`,
    `Authorization: Bearer ${WEBHOOK_TOKEN}`,
    "Content-Type: application/json",
    `Content-Length: ${lengthHeader}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
}

describe("request body limits on the real running server", () => {
  let proc: Subprocess | undefined;
  let sessionCookie = "";

  beforeAll(async () => {
    await rm(resolve(REPO_ROOT, DB_REL_DIR), { recursive: true, force: true });
    await deleteFeedConfig(FEED_ID).catch(() => {});
    await rm(EVENT_PATH, { force: true });
    for (const extension of ["xml", "atom", "json"]) {
      await rm(resolve(REPO_ROOT, "public/feeds", `${FEED_ID}.${extension}`), { force: true });
    }

    const fixture: WebhookFeedConfig = {
      feedId: FEED_ID,
      feedName: "P3 request body limits webhook fixture",
      feedType: "webhook",
      refreshTime: 3600,
      webhookFeed: {
        slug: SLUG,
        tokenHash: hashWebhookToken(WEBHOOK_TOKEN),
        maxItems: 100,
        retentionDays: 30,
        duplicateStrategy: "idOrHash",
        dateStrategy: "receivedAt",
        storeRawPayload: false,
        mapping: { mode: "native" },
      },
    };
    await writeFeedConfig(FEED_ID, fixture);

    proc = await spawnServer();
    sessionCookie = await login();
  }, 30_000);

  afterAll(async () => {
    await stopServer(proc);
    await deleteFeedConfig(FEED_ID).catch(() => {});
    await rm(EVENT_PATH, { force: true });
    for (const extension of ["xml", "atom", "json"]) {
      await rm(resolve(REPO_ROOT, "public/feeds", `${FEED_ID}.${extension}`), { force: true });
    }
    await rm(resolve(REPO_ROOT, DB_REL_DIR), { recursive: true, force: true });
  }, 15_000);

  // -------------------------------------------------------------------------
  // Requirement 12 — body-free and existing authentication behavior.
  // -------------------------------------------------------------------------

  test("body-free readiness, published-feed, and protected routes retain their existing contracts", async () => {
    const readiness = await fetch(`${BASE_URL}/readyz`);
    const readinessBody = await readiness.json();
    expect(readiness.status).toBe(200);
    expect(readinessBody.ready).toBe(true);

    const published = await fetch(`${BASE_URL}/public/feeds/p3-request-body-limits-no-such-feed.xml`, {
      redirect: "manual",
    });
    await published.body?.cancel();
    expect(published.status).toBe(404);

    const protectedRoute = await fetch(`${BASE_URL}/api/settings`, { redirect: "manual" });
    await protectedRoute.body?.cancel();
    expect(protectedRoute.status).toBe(302);
    expect(protectedRoute.headers.get("location")).toBe("/passkey");
  });

  test("an authenticated below-limit control request still reaches its route", async () => {
    const response = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: "{}",
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.settings).toBeDefined();
  });

  test("an anonymous valid-token webhook remains functional below its 64 KiB cap", async () => {
    const response = await fetch(`${BASE_URL}/webhook-feeds/${SLUG}`, {
      method: "POST",
      headers: webhookHeaders(),
      body: JSON.stringify({ id: "small-anonymous-event", title: "Small anonymous webhook event" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Requirements 1 and 5 — fallback cap, exercised by a body-bearing GET.
  // -------------------------------------------------------------------------

  test("the fallback cap accepts exactly 1 MiB and rejects one additional byte", async () => {
    const exact = await requestWithDeclaredLength({
      method: "GET",
      path: "/readyz",
      body: Buffer.alloc(LIMITS.fallback, 0x61),
      headers: { "content-type": "application/octet-stream" },
    });
    expect(exact.status, "an exact fallback-limit body must still reach /readyz").toBe(200);

    const overBody = Buffer.concat([
      Buffer.from(BODY_MARKER, "utf8"),
      Buffer.alloc(LIMITS.fallback + 1 - utf8Bytes(BODY_MARKER), 0x62),
    ]);
    const over = await requestWithDeclaredLength({
      method: "GET",
      path: "/readyz",
      body: overBody,
      headers: { "content-type": "application/octet-stream" },
    });
    await expectPayloadTooLarge(over, BODY_MARKER);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Requirement 4 and 6 — passkey form cap and form-parser precedence.
  // -------------------------------------------------------------------------

  test("POST /passkey accepts exactly 8 KiB and rejects an 8 KiB-plus-one form body", async () => {
    const exactBody = passkeyFormOfByteLength(LIMITS.passkey);
    expect(utf8Bytes(exactBody)).toBe(LIMITS.passkey);
    const exact = await fetch(`${BASE_URL}/passkey`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(utf8Bytes(exactBody)),
      },
      body: exactBody,
    });
    await exact.body?.cancel();
    expect(exact.status, "an exact passkey-limit form must reach credential parsing").toBe(302);
    expect(exact.headers.get("location")).toBe("/public/");

    const overBody = passkeyFormOfByteLength(LIMITS.passkey + 1, BODY_MARKER);
    const over = await fetch(`${BASE_URL}/passkey`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(utf8Bytes(overBody)),
      },
      body: overBody,
    });
    await expectPayloadTooLarge(over, BODY_MARKER);
  });

  test("an oversized malformed multipart form gets 413 before passkey parsing", async () => {
    const boundary = "p3-request-body-limits-boundary";
    const prefix =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="passkey"\r\n\r\n` +
      `${BODY_MARKER}\r\n`;
    // Deliberately omit the closing boundary. Without an early size check,
    // parseBody must see this malformed form and return a parser/error path.
    const body = asciiBodyOfByteLength(LIMITS.passkey + 1, prefix);
    const response = await fetch(`${BASE_URL}/passkey`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(utf8Bytes(body)),
      },
      body,
    });
    await expectPayloadTooLarge(response, BODY_MARKER);
  });

  // -------------------------------------------------------------------------
  // Requirement 3, 5, 6, 8, and 10 — webhook cap and byte semantics.
  // -------------------------------------------------------------------------

  test("POST /webhook-feeds/:slug accepts exactly 64 KiB and rejects one byte over", async () => {
    const exactBody = jsonBodyOfByteLength(
      LIMITS.webhook,
      { id: "declared-exact-webhook", title: "Declared exact webhook event" },
    );
    expect(utf8Bytes(exactBody)).toBe(LIMITS.webhook);
    const exact = await fetch(`${BASE_URL}/webhook-feeds/${SLUG}`, {
      method: "POST",
      headers: { ...webhookHeaders(), "content-length": String(utf8Bytes(exactBody)) },
      body: exactBody,
    });
    const exactJson = await exact.json();
    expect(exact.status, "an exact webhook-limit body must reach webhook parsing").toBe(200);
    expect(exactJson.ok).toBe(true);

    const overBody = jsonBodyOfByteLength(
      LIMITS.webhook + 1,
      { id: "declared-over-webhook", title: "Declared over-limit webhook event", marker: BODY_MARKER },
    );
    const over = await fetch(`${BASE_URL}/webhook-feeds/${SLUG}?limit=1048576`, {
      method: "POST",
      headers: {
        ...webhookHeaders(),
        // These must not select a more permissive limit.
        "content-type": "text/plain",
        "x-mkfd-body-limit": "1048576",
        "content-length": String(utf8Bytes(overBody)),
      },
      body: overBody,
    });
    await expectPayloadTooLarge(over, BODY_MARKER);
  });

  test("UTF-8 bodies are counted by encoded bytes at the webhook boundary", async () => {
    const exactBody = jsonBodyOfByteLength(
      LIMITS.webhook,
      { id: "utf8-exact-webhook", title: "UTF-8 exact webhook event" },
      "é",
    );
    expect(exactBody.length).toBeLessThan(utf8Bytes(exactBody));
    expect(utf8Bytes(exactBody)).toBe(LIMITS.webhook);
    const exact = await fetch(`${BASE_URL}/webhook-feeds/${SLUG}`, {
      method: "POST",
      headers: { ...webhookHeaders(), "content-length": String(utf8Bytes(exactBody)) },
      body: exactBody,
    });
    expect(exact.status, "an exact UTF-8 byte-limit body must be accepted").toBe(200);
    await exact.body?.cancel();

    const overBody = jsonBodyOfByteLength(
      LIMITS.webhook + 1,
      { id: "utf8-over-webhook", title: "UTF-8 over-limit webhook event", marker: BODY_MARKER },
      "é",
    );
    expect(overBody.length).toBeLessThan(utf8Bytes(overBody));
    expect(utf8Bytes(overBody)).toBe(LIMITS.webhook + 1);
    const over = await fetch(`${BASE_URL}/webhook-feeds/${SLUG}`, {
      method: "POST",
      headers: { ...webhookHeaders(), "content-length": String(utf8Bytes(overBody)) },
      body: overBody,
    });
    await expectPayloadTooLarge(over, BODY_MARKER);
  });

  test("a declared oversized malformed JSON body gets 413 before webhook JSON parsing", async () => {
    const malformed = asciiBodyOfByteLength(
      LIMITS.webhook + 1,
      `{"title":"${BODY_MARKER}`,
    );
    const response = await fetch(`${BASE_URL}/webhook-feeds/${SLUG}`, {
      method: "POST",
      headers: { ...webhookHeaders(), "content-length": String(utf8Bytes(malformed)) },
      body: malformed,
    });
    await expectPayloadTooLarge(response, BODY_MARKER);
  });

  test("a valid oversized Content-Length is rejected from headers before any body is uploaded", async () => {
    const open = openHeadersOnlyRequest(
      [
        `POST /webhook-feeds/${SLUG} HTTP/1.1`,
        `Host: 127.0.0.1:${PORT}`,
        `Authorization: Bearer ${WEBHOOK_TOKEN}`,
        "Content-Type: application/json",
        `Content-Length: ${LIMITS.webhook + 1}`,
        "Connection: keep-alive",
        "",
        "",
      ].join("\r\n"),
    );
    try {
      const response = await awaitResponseWithin(
        open.response,
        "header-only oversized Content-Length response",
      );
      await expectPayloadTooLarge(response);
    } finally {
      open.close();
    }
  });

  // -------------------------------------------------------------------------
  // Requirement 7 — unknown-length streaming and lossless replay.
  // -------------------------------------------------------------------------

  test("a permitted chunked webhook body is replayed byte-for-byte to JSON parsing", async () => {
    const title = "Chunked replay résumé 🚀";
    const body = JSON.stringify({
      id: "chunked-lossless-webhook",
      title,
      description: "UTF-8 bytes cross several chunk boundaries",
    });
    expect(utf8Bytes(body)).toBeLessThan(LIMITS.webhook);
    const response = await requestChunked({
      method: "POST",
      path: `/webhook-feeds/${SLUG}`,
      chunks: chunksFromBody(body),
      headers: webhookHeaders(),
    });
    const responseJson = JSON.parse(response.body);
    expect(response.status, "a permitted chunked body must reach webhook parsing").toBe(200);
    expect(responseJson.ok).toBe(true);

    const events = readPersistedWebhookRows("chunked-lossless-webhook");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      external_id: "chunked-lossless-webhook",
      title,
      description: "UTF-8 bytes cross several chunk boundaries",
    });
  });

  test("a chunked body is rejected as soon as it crosses the webhook cap", async () => {
    const body = jsonBodyOfByteLength(
      LIMITS.webhook + 1,
      { id: "chunked-over-webhook", title: "Chunked over-limit webhook event", marker: BODY_MARKER },
    );
    const response = await requestChunked({
      method: "POST",
      path: `/webhook-feeds/${SLUG}`,
      chunks: chunksFromBody(body),
      headers: webhookHeaders(),
    });
    await expectPayloadTooLarge(response, BODY_MARKER);
    expect(readPersistedWebhookRows("chunked-over-webhook")).toHaveLength(0);
  });

  test("a chunked request receives sanitized 413 at cap plus one before end-of-stream", async () => {
    const body = jsonBodyOfByteLength(
      LIMITS.webhook + 1,
      { id: "chunked-open-over-webhook", title: "Chunked open over-limit webhook event", marker: BODY_MARKER },
    );
    const bytes = new TextEncoder().encode(body);
    const open = openChunkedRequest({
      method: "POST",
      path: `/webhook-feeds/${SLUG}`,
      headers: webhookHeaders(),
    });
    try {
      open.write(bytes.subarray(0, LIMITS.webhook));
      open.write(bytes.subarray(LIMITS.webhook));
      const response = await awaitResponseWithin(
        open.response,
        "chunked cap-plus-one response",
      );
      expect(open.writableEnded(), "the client must not have sent the terminating zero chunk").toBe(false);
      await expectPayloadTooLarge(response, BODY_MARKER);
    } finally {
      open.close();
    }
  });

  // -------------------------------------------------------------------------
  // Requirement 2 and 5 — all state-changing method classes use 256 KiB.
  // -------------------------------------------------------------------------

  const stateChangingCases = [
    { method: "POST", path: "/preview", expectedExactStatus: 400 },
    { method: "PUT", path: "/api/settings", expectedExactStatus: 400 },
    {
      method: "PATCH",
      path: "/api/feeds/p3-request-body-limits-missing/enabled",
      expectedExactStatus: 404,
    },
    { method: "DELETE", path: "/api/feeds/p3-request-body-limits-missing", expectedExactStatus: 404 },
  ] as const;

  test("every state-changing method accepts an exact 256 KiB body and preserves route semantics", async () => {
    for (const route of stateChangingCases) {
      const body = jsonBodyOfByteLength(LIMITS.stateChanging, {
        enabled: true,
        route: route.method,
        marker: `${BODY_MARKER}-${route.method}-exact`,
      });
      const response = await fetch(`${BASE_URL}${route.path}`, {
        method: route.method,
        redirect: "manual",
        headers: {
          cookie: sessionCookie,
          "content-type": "application/json",
          "content-length": String(utf8Bytes(body)),
        },
        body,
      });
      await response.body?.cancel();
      expect(response.status, `${route.method} exact-limit body must reach the route`).toBe(route.expectedExactStatus);
    }
  }, 30_000);

  test("every state-changing method rejects a body one byte over 256 KiB", async () => {
    const malformed = asciiBodyOfByteLength(LIMITS.stateChanging + 1, `{"${BODY_MARKER}":`);
    for (const route of stateChangingCases) {
      const response = await fetch(`${BASE_URL}${route.path}`, {
        method: route.method,
        redirect: "manual",
        headers: {
          cookie: sessionCookie,
          "content-type": "application/json",
          "content-length": String(utf8Bytes(malformed)),
        },
        body: malformed,
      });
      await expectPayloadTooLarge(response, BODY_MARKER);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // Requirement 9 — malformed framing metadata over raw TCP.
  // -------------------------------------------------------------------------

  test("negative, non-decimal, list-valued, and conflicting Content-Length are rejected as malformed", async () => {
    const cases = [
      { name: "negative", value: "-1" },
      { name: "non-decimal", value: "abc" },
      { name: "ambiguous list", value: "1, 2" },
      { name: "fractional", value: "1.5" },
      { name: "conflicting duplicate", value: "1\r\nContent-Length: 2" },
    ];

    for (const testCase of cases) {
      const response = await rawTcpRequest(invalidLengthRequest(testCase.value));
      expect(response.status, `${testCase.name} Content-Length must be rejected as malformed`).toBe(400);
      expect(response.body).not.toContain(BODY_MARKER);
    }
  });
});
