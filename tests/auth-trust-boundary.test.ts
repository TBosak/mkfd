// Integration coverage for slice p2-auth-trust-boundary.
//
// These tests drive the *real* mkfd server as a subprocess over real loopback
// TCP, the same way `docker-compose.yml` / `frontend/playwright.config.ts`
// already do (`bun index.ts` on the hardcoded port 5000). This exercises the
// genuine mount order, route exceptions, and middleware stack — not a
// hand-rolled reimplementation of the auth middleware.
//
// Assumed interface (not yet implemented; the brief does not name one):
//   - Dev bypass opt-in: env var TRUST_LOCAL=true (mirrors the roadmap's
//     documented `--trust-local` flag, see mkfd-audit-aggregate-0526.md:186).
//   - "Production-shaped configuration": NODE_ENV=production.
// If the lead picks different names during test review, only these
// constants need to change.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteFeedConfig, writeFeedConfig } from "../utilities/config-manager.utility";
import { hashWebhookToken } from "../utilities/webhook-feed.utility";
import type { WebhookFeedConfig } from "../models/feed-config.model";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

const BASE_SECRETS = {
  PASSKEY: "auth-trust-boundary-test-passkey",
  COOKIE_SECRET: "auth-trust-boundary-cookie-secret-32-chars",
  ENCRYPTION_KEY: "auth-trust-boundary-encrypt-key-32-chars",
};

const DEV_BYPASS_ENV_VAR = "TRUST_LOCAL";
const PRODUCTION_ENV = { NODE_ENV: "production" };

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

async function spawnServer(dbSubdir: string, env: Record<string, string> = {}): Promise<Subprocess> {
  const proc = Bun.spawn([process.execPath, "index.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...BASE_SECRETS,
      RUNTIME_DB_PATH: `./.tdd-state/_auth-trust-boundary-db-${dbSubdir}/runtime.db`,
      ...env,
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

function rawSetCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Response did not set any cookie");
  return setCookie;
}

function sessionCookiePair(res: Response): string {
  const [pair] = rawSetCookie(res).split(";");
  return pair.trim();
}

/** Logs in against whatever server is currently listening on BASE_URL. */
async function login(passkey: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}/passkey`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    },
    body: `passkey=${encodeURIComponent(passkey)}`,
  });
}

describe("shipped deployment configuration does not enable the dev bypass", () => {
  test("docker-compose.yml does not set the local-auth bypass", async () => {
    const compose = await readFile(resolve(REPO_ROOT, "docker-compose.yml"), "utf8");
    expect(compose).not.toMatch(new RegExp(DEV_BYPASS_ENV_VAR, "i"));
  });

  test("dockerfile does not set the local-auth bypass", async () => {
    const dockerfile = await readFile(resolve(REPO_ROOT, "dockerfile"), "utf8");
    expect(dockerfile).not.toMatch(new RegExp(DEV_BYPASS_ENV_VAR, "i"));
  });
});

describe("core trust boundary via a real running server", () => {
  let proc: Subprocess | undefined;
  let sessionCookie: string;
  let loginSetCookieHeader: string;
  const feedId = "auth-trust-boundary-webhook-feed";
  const slug = "auth-trust-boundary-webhook-slug";
  const validToken = "mkfd_wh_auth_trust_boundary_test_token";

  beforeAll(async () => {
    proc = await spawnServer("core");

    const webhookFixture: WebhookFeedConfig = {
      feedId,
      feedName: "Auth trust boundary webhook fixture",
      feedType: "webhook",
      refreshTime: 3600,
      webhookFeed: {
        slug,
        tokenHash: hashWebhookToken(validToken),
        maxItems: 50,
        retentionDays: 30,
        duplicateStrategy: "idOrHash",
        dateStrategy: "receivedAt",
        storeRawPayload: false,
        mapping: { mode: "native" },
      },
    };
    await writeFeedConfig(feedId, webhookFixture);

    const loginRes = await login(BASE_SECRETS.PASSKEY);
    loginSetCookieHeader = rawSetCookie(loginRes);
    sessionCookie = sessionCookiePair(loginRes);
    await loginRes.body?.cancel();
  }, 30000);

  afterAll(async () => {
    await stopServer(proc);
    await deleteFeedConfig(feedId).catch(() => {});
    await rm(resolve(REPO_ROOT, "public/feeds", `${feedId}.xml`), { force: true }).catch(() => {});
    await rm(resolve(REPO_ROOT, "public/feeds", `${feedId}.atom`), { force: true }).catch(() => {});
    await rm(resolve(REPO_ROOT, "public/feeds", `${feedId}.json`), { force: true }).catch(() => {});
    await rm(resolve(REPO_ROOT, "feed-state/webhooks", `${feedId}.jsonl`), { force: true }).catch(() => {});
  }, 15000);

  // -------------------------------------------------------------------------
  // Requirement 1 & 2 — regression: loopback must not authorize
  // -------------------------------------------------------------------------

  test("an anonymous request over real loopback TCP is refused, not granted access", async () => {
    // This is the literal shipped defect: a reverse proxy on the same host
    // makes every remote visitor's peer address 127.0.0.1 to this process,
    // and our own test client *is* that loopback peer.
    const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
    const body = await res.text();
    expect(res.status).not.toBe(200);
    expect(body).not.toContain('id="root"');
  });

  test("the dev bypass is off by default (no opt-in env var set)", async () => {
    const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
    await res.body?.cancel();
    expect(res.status).not.toBe(200);
  });

  test("logging in with the correct passkey succeeds even though the client's peer looks local", async () => {
    // Today, isLocal short-circuits authMiddleware for any loopback client
    // *before* the inline POST /passkey handling ever runs, so this request
    // 404s instead of authenticating. Once loopback is no longer trusted,
    // every client — including one on loopback — must be routed through
    // real credential verification.
    const res = await login(BASE_SECRETS.PASSKEY);
    await res.body?.cancel();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe("/");
  });

  test("an anonymous session cookie that never authenticated does not grant access to the app", async () => {
    // Closes the gap a naive fix could leave open: merely possessing *a*
    // session cookie (one hono-sessions issues to every visitor) must not
    // be conflated with holding an *authenticated* session.
    const passkeyPage = await fetch(`${BASE_URL}/passkey`);
    const neverAuthenticatedCookie = sessionCookiePair(passkeyPage);
    await passkeyPage.body?.cancel();

    const res = await fetch(`${BASE_URL}/`, {
      redirect: "manual",
      headers: { cookie: neverAuthenticatedCookie },
    });
    await res.body?.cancel();
    expect(res.status).not.toBe(200);
  });

  // -------------------------------------------------------------------------
  // Requirement 9 — webhook ingress trap
  // -------------------------------------------------------------------------

  test("POST /webhook-feeds/:slug succeeds anonymously with a valid token", async () => {
    const res = await fetch(`${BASE_URL}/webhook-feeds/${slug}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${validToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Auth trust boundary webhook event" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  test("POST /webhook-feeds/:slug is refused with an invalid token, even though the peer is local", async () => {
    const res = await fetch(`${BASE_URL}/webhook-feeds/${slug}`, {
      method: "POST",
      headers: {
        authorization: "Bearer not-the-right-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Should be rejected" }),
    });
    await res.body?.cancel();
    expect(res.status).toBe(401);
  });

  test("the webhook exception does not widen into a general local-auth bypass for other routes", async () => {
    const health = await fetch(`${BASE_URL}/api/health/summary`, { redirect: "manual" });
    await health.body?.cancel();
    expect(health.status).not.toBe(200);

    const triggerWebhook = await fetch(`${BASE_URL}/trigger-webhook`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await triggerWebhook.body?.cancel();
    expect(triggerWebhook.status).not.toBe(200);
  });

  // -------------------------------------------------------------------------
  // Requirement 10 — /public/feeds/* stays anonymously readable
  // -------------------------------------------------------------------------

  test("/public/feeds/* remains reachable anonymously (static handler, not the auth redirect)", async () => {
    const res = await fetch(`${BASE_URL}/public/feeds/does-not-exist.xml`, { redirect: "manual" });
    await res.body?.cancel();
    // The static file handler 404s; the auth gate would instead redirect to
    // /passkey (or 401/403). Either of those would prove the exception was
    // narrowed or removed.
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Requirement 7 — session cookie hardening
  // -------------------------------------------------------------------------

  test("a successful login issues a hardened session cookie", () => {
    expect(loginSetCookieHeader).toMatch(/HttpOnly/i);
    expect(loginSetCookieHeader).toMatch(/SameSite=(Lax|Strict)/i);
    // Policy: Secure reflects whether the connection is actually over TLS
    // (directly, or via a trusted proxy reporting X-Forwarded-Proto: https),
    // never a disconnected SSL startup flag. This request is genuine plain
    // HTTP over real loopback TCP with no forwarded-proto claim at all, so
    // Secure must be absent — a self-hosted plain-HTTP LAN install must
    // still be able to store and send its session cookie back. The
    // TLS-present and forged-header-from-an-untrusted-peer cases (where
    // Secure must be present, and must NOT be forgeable, respectively) are
    // covered in tests/auth-connection-info-boundary.test.ts, which can
    // control the request's scheme and peer directly.
    expect(loginSetCookieHeader).not.toMatch(/;\s*Secure/i);
  });

  test("a valid session cookie grants access to the app", async () => {
    const res = await fetch(`${BASE_URL}/`, {
      redirect: "manual",
      headers: { cookie: sessionCookie },
    });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('id="root"');
  });

  // -------------------------------------------------------------------------
  // Requirement 6 — origin/CSRF guard (mkfd-audit-aggregate-0526.md:428)
  // -------------------------------------------------------------------------

  test("a cross-origin state-changing POST with a valid session cookie is refused", async () => {
    const res = await fetch(`${BASE_URL}/delete-feed`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: sessionCookie,
        origin: "http://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const body = await res.text();
    expect(res.status).toBe(403);
    // Must be blocked *before* the route handler runs, not merely fail
    // there for an unrelated reason (missing feedId).
    expect(body).not.toContain("Feed name is required");
  });

  test("an Origin that merely contains the expected host as a substring is still refused", async () => {
    // A real attacker-registrable domain: "localhost.evil.example" contains
    // "localhost" as a literal substring of a naive check.
    const res = await fetch(`${BASE_URL}/delete-feed`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: sessionCookie,
        origin: `http://localhost.evil.example:${PORT}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const body = await res.text();
    expect(res.status).toBe(403);
    expect(body).not.toContain("Feed name is required");
  });

  test("a same-origin state-changing POST with a valid session cookie reaches the route handler", async () => {
    const res = await fetch(`${BASE_URL}/delete-feed`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: sessionCookie,
        origin: BASE_URL,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const body = await res.text();
    // Reached the handler: it validated the (missing) feedId itself.
    expect(res.status).toBe(400);
    expect(body).toContain("Feed name is required");
  });

  test("safe methods are unaffected by the origin/CSRF guard", async () => {
    const res = await fetch(`${BASE_URL}/`, {
      redirect: "manual",
      headers: {
        cookie: sessionCookie,
        origin: "http://evil.example",
      },
    });
    await res.body?.cancel();
    expect(res.status).toBe(200);
  });
});

describe("dev bypass cannot activate in a production-shaped configuration", () => {
  let proc: Subprocess | undefined;

  beforeAll(async () => {
    proc = await spawnServer("prod-shaped", {
      [DEV_BYPASS_ENV_VAR]: "true",
      ...PRODUCTION_ENV,
    });
  }, 30000);

  afterAll(async () => {
    await stopServer(proc);
  }, 15000);

  test("anonymous loopback access is still refused even with the bypass var set in a production-shaped config", async () => {
    const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
    const body = await res.text();
    expect(res.status).not.toBe(200);
    expect(body).not.toContain('id="root"');
  });
});

describe("login throttling on POST /passkey", () => {
  let proc: Subprocess | undefined;

  beforeAll(async () => {
    proc = await spawnServer("throttle");
  }, 30000);

  afterAll(async () => {
    await stopServer(proc);
  }, 15000);

  test("repeated failures lock out even the correct passkey, and rotating a client header cannot reset the counter", async () => {
    const attempts = 20;
    const statuses: number[] = [];
    for (let i = 0; i < attempts; i++) {
      const res = await login("definitely-not-the-passkey", {
        // A client can trivially rotate this on every request. If the
        // throttle were keyed on it, this loop would never lock out.
        "x-forwarded-for": `203.0.113.${i % 255}`,
      });
      statuses.push(res.status);
      await res.body?.cancel();
    }

    // Discriminates on its own, independent of whether POST /passkey is
    // otherwise reachable for this client: a throttled response must be
    // observably distinct (429) from an ordinary "wrong passkey" response.
    expect(statuses).toContain(429);

    const finalAttempt = await login(BASE_SECRETS.PASSKEY, {
      "x-forwarded-for": "203.0.113.250",
    });
    const location = finalAttempt.headers.get("location");
    await finalAttempt.body?.cancel();

    // A successful login redirects to "/". If throttled, it must not. (This
    // assertion is also satisfied once requirement 1's loopback fix lands
    // and POST /passkey genuinely processes credentials for this client.)
    expect(location).not.toBe("/");
  });
});
