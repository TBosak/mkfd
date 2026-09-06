// Integration coverage for slice p2-configs-static-serving-removal.
//
// Drives the *real* mkfd server as a subprocess over real loopback TCP, the
// same way tests/auth-trust-boundary.test.ts does, so a RED result here
// reflects the actual `/configs/*` static mount (index.ts:351) rather than a
// hand-rolled reimplementation of it.
//
// Requirement 2's traversal cases are sent over a raw node:http connection
// instead of through the Fetch API. The WHATWG URL parser normalizes literal
// ".." path segments (and, for special schemes, treats "\" identically to
// "/") before a fetch() request ever leaves the process — a real attacker's
// raw HTTP client performs no such courtesy. Sending the exact bytes over
// the wire is what makes this a genuine request through the app rather than
// a client-side-sanitized approximation of one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { request as httpRequest } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteFeedConfig } from "../utilities/config-manager.utility";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

const BASE_SECRETS = {
  PASSKEY: "configs-static-serving-removal-test-passkey",
  COOKIE_SECRET: "configs-static-serving-removal-cookie-secret-32-chars",
  ENCRYPTION_KEY: "configs-static-serving-removal-encryption-key-32chr",
};

async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await res.body?.cancel();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
  }
  throw new Error(`mkfd server did not become ready at ${url}: ${String(lastErr)}`);
}

async function spawnServer(dbSubdir: string): Promise<Subprocess> {
  const proc = Bun.spawn([process.execPath, "index.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...BASE_SECRETS,
      RUNTIME_DB_PATH: `./.tdd-state/_configs-static-serving-removal-db-${dbSubdir}/runtime.db`,
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

/** The last `Set-Cookie: session=...` pair (see auth-trust-boundary.test.ts: hono-sessions writes an unauthenticated cookie before `next()`, then an authenticated one after — both named `session`). */
function sessionCookiePair(res: Response): string {
  const setCookies = res.headers.getSetCookie().filter((entry) => entry.toLowerCase().startsWith("session="));
  if (setCookies.length === 0) throw new Error("Response did not set a session cookie");
  return setCookies[setCookies.length - 1].split(";")[0].trim();
}

async function login(passkey: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/passkey`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `passkey=${encodeURIComponent(passkey)}`,
  });
  const cookie = sessionCookiePair(res);
  await res.body?.cancel();
  return cookie;
}

interface RawResponse {
  status: number;
  body: string;
}

/**
 * Sends the given path verbatim as the HTTP request target over a raw
 * node:http connection, bypassing the Fetch API's URL parser entirely so
 * literal ".."/backslash/percent-encoded bytes reach the server unmodified.
 */
function rawRequest(rawPath: string): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      { host: "localhost", port: PORT, path: rawPath, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("configs static serving removal — real running server", () => {
  let proc: Subprocess | undefined;
  let sessionCookie: string;
  let fixtureFeedId: string;
  let packageJsonContent: string;
  let utilityFileContent: string;

  const feedNameMarker = "Configs Static Serving Removal Fixture Marker QzR8vN";
  const secretToken = "configs-static-serving-removal-secret-token-4kD9Lp";
  // Deliberately unroutable (TCP port 1 is not listening on loopback) so the
  // background feed worker's immediate fetch attempt fails fast and locally
  // instead of depending on network access to a real third-party host.
  const unreachableFeedUrl = "http://127.0.0.1:1/configs-static-serving-removal-unreachable";

  beforeAll(async () => {
    proc = await spawnServer("core");
    sessionCookie = await login(BASE_SECRETS.PASSKEY);

    packageJsonContent = await readFile(resolve(REPO_ROOT, "package.json"), "utf8");
    utilityFileContent = await readFile(resolve(REPO_ROOT, "utilities/config-manager.utility.ts"), "utf8");

    // The fixture is created through the real, supported API — not by
    // writing a YAML file directly — so requirement 3 (creation) and the
    // /configs traversal target share one source of truth.
    const createRes = await fetch(`${BASE_URL}/`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({
        feedType: "rest",
        feedName: feedNameMarker,
        refreshTime: 600,
        feedUrl: unreachableFeedUrl,
        headers: { Authorization: { type: "protected", value: secretToken } },
      }),
    });
    const createBodyText = await createRes.text();
    if (createRes.status !== 200) {
      throw new Error(`Fixture feed creation failed: ${createRes.status} ${createBodyText}`);
    }
    const created = JSON.parse(createBodyText);
    fixtureFeedId = created.feedId as string;
  }, 30000);

  afterAll(async () => {
    await stopServer(proc);
    await deleteFeedConfig(fixtureFeedId).catch(() => {});
    await rm(resolve(REPO_ROOT, "public/feeds", `${fixtureFeedId}.xml`), { force: true }).catch(() => {});
    await rm(resolve(REPO_ROOT, "public/feeds", `${fixtureFeedId}.atom`), { force: true }).catch(() => {});
    await rm(resolve(REPO_ROOT, "public/feeds", `${fixtureFeedId}.json`), { force: true }).catch(() => {});
  }, 15000);

  // -------------------------------------------------------------------------
  // Requirement 1 — raw config files are no longer retrievable over HTTP
  // -------------------------------------------------------------------------

  describe("requirement 1: raw config files are no longer retrievable", () => {
    test("an anonymous request for a known-existing config does not return its contents", async () => {
      const res = await fetch(`${BASE_URL}/configs/${fixtureFeedId}.yaml`, { redirect: "manual" });
      const body = await res.text();
      // Removal is the expected shape (404 is the natural outcome), but the
      // decisive assertion is that the body never carries the file's
      // contents — a future "helpful" error page that echoes the requested
      // path must not be able to pass this test.
      expect(res.status).not.toBe(200);
      expect(body).not.toContain(feedNameMarker);
      expect(body).not.toContain(secretToken);
    });

    test("an authenticated request (valid session) for the same config does not return its contents either", async () => {
      const res = await fetch(`${BASE_URL}/configs/${fixtureFeedId}.yaml`, {
        redirect: "manual",
        headers: { cookie: sessionCookie },
      });
      const body = await res.text();
      expect(res.status).not.toBe(200);
      expect(body).not.toContain(feedNameMarker);
      expect(body).not.toContain(secretToken);
    });

    test("requesting the config by its bare filename under /configs/ (no session) does not return its contents", async () => {
      // Guards against an implementation that only special-cases the exact
      // path this test file used above, e.g. one keyed on a trailing slash
      // or query string rather than actually removing the mount.
      const res = await fetch(`${BASE_URL}/configs/${fixtureFeedId}.yaml?x=1`, { redirect: "manual" });
      const body = await res.text();
      expect(res.status).not.toBe(200);
      expect(body).not.toContain(feedNameMarker);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 2 — no path escapes the removed mount
  // -------------------------------------------------------------------------

  describe("requirement 2: no traversal sequence escapes the /configs prefix", () => {
    const packageJsonMarker = '"name": "mkfd"';
    const utilityMarker = "export function assertSafeFeedId";

    const cases: Array<{ name: string; path: string; target: "package.json" | "utility" }> = [
      { name: "literal ../", path: "/configs/../package.json", target: "package.json" },
      { name: "..%2f (single percent-encoded slash)", path: "/configs/..%2fpackage.json", target: "package.json" },
      { name: "%2e%2e%2f (fully percent-encoded dot-dot-slash)", path: "/configs/%2e%2e%2fpackage.json", target: "package.json" },
      { name: "backslash traversal (..\\\\)", path: "/configs/..\\package.json", target: "package.json" },
      { name: "double-encoded ../ (%252e%252e%252f)", path: "/configs/%252e%252e%252fpackage.json", target: "package.json" },
      { name: "absolute-looking doubled leading slash", path: "/configs//utilities/config-manager.utility.ts", target: "utility" },
      { name: "traversal reaching under utilities/", path: "/configs/../utilities/config-manager.utility.ts", target: "utility" },
    ];

    for (const testCase of cases) {
      test(`${testCase.name} does not leak ${testCase.target} contents`, async () => {
        const res = await rawRequest(testCase.path);
        const marker = testCase.target === "package.json" ? packageJsonMarker : utilityMarker;
        const fullContent = testCase.target === "package.json" ? packageJsonContent : utilityFileContent;
        expect(res.status).not.toBe(200);
        expect(res.body).not.toContain(marker);
        expect(res.body).not.toContain(fullContent);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Requirement 3 & 4 — feed configuration still works end to end through the
  // supported API, and protected values stay masked on that surviving path.
  // -------------------------------------------------------------------------

  describe("requirement 3 & 4: create/read/update/delete via the supported API, with protected values masked", () => {
    test("GET /api/feeds/:id/config returns the created feed with the protected header masked, never as a raw envelope", async () => {
      const res = await fetch(`${BASE_URL}/api/feeds/${fixtureFeedId}/config`, {
        headers: { cookie: sessionCookie },
      });
      const config = await res.json();
      expect(res.status).toBe(200);
      expect(config.feedName).toBe(feedNameMarker);
      expect(config.headers.Authorization).toEqual({ type: "protected", value: "********" });

      const raw = JSON.stringify(config);
      expect(raw).not.toContain(secretToken);
      // A raw AES-256-GCM envelope (see utilities/security.utility.ts encrypt())
      // is a JSON object with these three fields; none should ever reach the
      // masked API response.
      expect(raw).not.toContain('"iv"');
      expect(raw).not.toContain('"tag"');
      expect(raw).not.toContain('"ct"');
    });

    test("PUT /api/feeds/:id updates the feed and the change is visible on a subsequent read, with the mask sentinel preserving the original ciphertext", async () => {
      const updatedName = `${feedNameMarker} (updated)`;
      const putRes = await fetch(`${BASE_URL}/api/feeds/${fixtureFeedId}`, {
        method: "PUT",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: JSON.stringify({
          feedType: "rest",
          feedName: updatedName,
          refreshTime: 600,
          feedUrl: unreachableFeedUrl,
          headers: { Authorization: { type: "protected", value: "********" } },
        }),
      });
      expect(putRes.status).toBe(200);

      const getRes = await fetch(`${BASE_URL}/api/feeds/${fixtureFeedId}/config`, {
        headers: { cookie: sessionCookie },
      });
      const config = await getRes.json();
      expect(config.feedName).toBe(updatedName);
      expect(config.headers.Authorization).toEqual({ type: "protected", value: "********" });
    });

    test("DELETE /api/feeds/:id removes the feed; a subsequent read 404s", async () => {
      const delRes = await fetch(`${BASE_URL}/api/feeds/${fixtureFeedId}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      });
      expect(delRes.status).toBe(204);

      const getRes = await fetch(`${BASE_URL}/api/feeds/${fixtureFeedId}/config`, {
        headers: { cookie: sessionCookie },
      });
      expect(getRes.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 5 — published feed output is unaffected
  // -------------------------------------------------------------------------

  describe("requirement 5: /public/feeds/* remains reachable without a session", () => {
    test("an anonymous request for /public/feeds/* is handled by the static mount, not the auth gate", async () => {
      const res = await fetch(`${BASE_URL}/public/feeds/configs-static-serving-removal-does-not-exist.xml`, {
        redirect: "manual",
      });
      const body = await res.text();
      // The static file handler 404s directly; the auth gate would instead
      // redirect to /passkey (or answer 401/403). Either of those would
      // prove the /configs removal accidentally caught /public/feeds too.
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).not.toBe("/passkey");
      expect(body).not.toContain('id="root"');
    });
  });
});

// -----------------------------------------------------------------------------
// Requirement 6 — the dev proxy matches production (no /configs, /public and
// /vendor untouched). No running server needed: this reads the checked-in
// source, in the style of tests/e2e-harness-config.test.ts.
// -----------------------------------------------------------------------------

describe("frontend/vite.config.ts dev proxy matches production", () => {
  test("the /configs proxy entry is removed now that the mount is gone", async () => {
    const source = await readFile(resolve(REPO_ROOT, "frontend/vite.config.ts"), "utf8");
    expect(source).not.toMatch(/["']\/configs["']\s*:/);
  });

  test("the /public proxy entry remains — it enforces the session gate in the browser suite (CF-10)", async () => {
    const source = await readFile(resolve(REPO_ROOT, "frontend/vite.config.ts"), "utf8");
    expect(source).toMatch(/["']\/public["']\s*:\s*\{[^}]*target:\s*["']http:\/\/localhost:5000["']/);
  });

  test("the /vendor proxy entry remains untouched", async () => {
    const source = await readFile(resolve(REPO_ROOT, "frontend/vite.config.ts"), "utf8");
    expect(source).toMatch(/["']\/vendor["']\s*:\s*\{[^}]*target:\s*["']http:\/\/localhost:5000["']/);
  });
});
