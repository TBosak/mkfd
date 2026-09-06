// TDD slice: p2-csp-security-headers
//
// Integration coverage for requirements 1, 2, 3, and 7 of the requirements
// brief: a baseline set of security headers on every kind of application
// response, a strict script-src on the SPA (and, incidentally, the login
// page), framing control on ordinary (non-/proxy) responses, and published
// feeds remaining reachable and parseable once the headers land.
//
// Drives the *real* mkfd server as a subprocess over real loopback TCP,
// exactly the way tests/auth-trust-boundary.test.ts and
// tests/configs-static-serving-removal.test.ts already do, so a RED result
// here reflects the actual response pipeline (app-wide middleware + route
// handlers) rather than a hand-rolled reimplementation of it.
//
// Stated policy assumption (the brief's open question on frame-ancestors):
// these tests assume `frame-ancestors 'none'` and `X-Frame-Options: DENY`
// on every response *except* GET /proxy, which legitimately continues to be
// framed by this app's own Selector Playground from the app's own origin
// (see frontend/e2e/selector-playground-isolation.spec.ts, locked) and is
// therefore exempted — proven separately in
// tests/security-headers-playground-csp-unchanged.test.ts, which also
// proves the app-wide middleware does not append frame-ancestors (or
// anything else) to that route's already-locked Content-Security-Policy.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

const BASE_SECRETS = {
  PASSKEY: "security-headers-baseline-test-passkey",
  COOKIE_SECRET: "security-headers-baseline-cookie-secret-32-chars",
  ENCRYPTION_KEY: "security-headers-baseline-encrypt-key-32-chars",
};

// Referrer policies that never disclose a full cross-origin URL. "no-referrer"
// sends nothing; the "origin"/"strict-origin"/"strict-origin-when-cross-origin"
// family sends at most the origin cross-origin; "same-origin" sends nothing
// cross-origin at all.
const SAFE_REFERRER_POLICIES = new Set([
  "no-referrer",
  "same-origin",
  "origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);

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
      RUNTIME_DB_PATH: `./.tdd-state/_security-headers-baseline-db-${dbSubdir}/runtime.db`,
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

function extractDirective(csp: string, name: string): string[] {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`, "i").exec(csp);
  if (!match) return [];
  return match[1].trim().split(/\s+/).filter(Boolean);
}

function directiveNames(csp: string): string[] {
  return csp
    .split(";")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map((name) => name.toLowerCase());
}

interface ResponseKindCase {
  name: string;
  fetchIt: () => Promise<Response>;
}

describe("security headers on a real running server", () => {
  let proc: Subprocess | undefined;
  let sessionCookie: string;
  const feedFixtureId = "security-headers-baseline-published-fixture";
  const feedFixturePath = resolve(REPO_ROOT, "public/feeds", `${feedFixtureId}.xml`);
  const feedFixtureXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0"><channel><title>Security Headers Baseline Fixture</title>' +
    "<link>https://example.test/security-headers-baseline</link>" +
    "<description>fixture feed for header assertions</description></channel></rss>";

  beforeAll(async () => {
    await mkdir(resolve(REPO_ROOT, "public/feeds"), { recursive: true });
    await writeFile(feedFixturePath, feedFixtureXml, "utf8");
    proc = await spawnServer("core");
    sessionCookie = await login(BASE_SECRETS.PASSKEY);
  }, 30000);

  afterAll(async () => {
    await stopServer(proc);
    await rm(feedFixturePath, { force: true });
  }, 15000);

  const cases = (): ResponseKindCase[] => [
    {
      name: "the SPA root (authenticated)",
      fetchIt: () => fetch(`${BASE_URL}/`, { headers: { cookie: sessionCookie }, redirect: "manual" }),
    },
    {
      name: "the login page (unauthenticated)",
      fetchIt: () => fetch(`${BASE_URL}/passkey`, { redirect: "manual" }),
    },
    {
      name: "a JSON API response (authenticated)",
      fetchIt: () => fetch(`${BASE_URL}/api/feeds`, { headers: { cookie: sessionCookie }, redirect: "manual" }),
    },
    {
      name: "a published feed (anonymous)",
      fetchIt: () => fetch(`${BASE_URL}/public/feeds/${feedFixtureId}.xml`, { redirect: "manual" }),
    },
  ];

  // ---------------------------------------------------------------------
  // Requirement 1 — baseline headers on several different response kinds
  // ---------------------------------------------------------------------

  describe("requirement 1: every response kind carries the baseline header set", () => {
    for (const { name, fetchIt } of cases()) {
      test(`${name} carries nosniff, a safe referrer policy, and a CSP`, async () => {
        const res = await fetchIt();
        const body = await res.text();
        expect(res.status).toBe(200);

        expect(res.headers.get("x-content-type-options")).toBe("nosniff");

        const referrerPolicy = (res.headers.get("referrer-policy") ?? "").toLowerCase();
        expect(SAFE_REFERRER_POLICIES.has(referrerPolicy)).toBe(true);

        const csp = res.headers.get("content-security-policy");
        expect(csp).toBeTruthy();

        // Sanity: the response body actually is what it claims to be, so a
        // header-only fix that returns an empty or broken body could never
        // pass this loop by accident.
        expect(body.length).toBeGreaterThan(0);
      });
    }

    test("the four response kinds above are not identical responses in disguise (each is genuinely distinct)", async () => {
      const [root, login_, api, feed] = await Promise.all(cases().map((c) => c.fetchIt()));
      const [rootBody, loginBody, apiBody, feedBody] = await Promise.all([
        root.text(),
        login_.text(),
        api.text(),
        feed.text(),
      ]);
      expect(rootBody).toContain('id="root"');
      expect(loginBody).toContain("Enter Passkey");
      expect(() => JSON.parse(apiBody)).not.toThrow();
      expect(feedBody).toContain("<rss");
    });
  });

  // ---------------------------------------------------------------------
  // Requirement 2 — the SPA's CSP forbids inline and remote script
  // ---------------------------------------------------------------------

  describe("requirement 2: script-src is strict on the SPA (and, incidentally, the login page)", () => {
    test("the SPA root's script-src allows only this origin, not inline or eval", async () => {
      const res = await fetch(`${BASE_URL}/`, { headers: { cookie: sessionCookie }, redirect: "manual" });
      const csp = res.headers.get("content-security-policy");
      await res.text();
      expect(csp).toBeTruthy();
      if (!csp) return;

      // Falls back to default-src the same way the locked
      // tests/selector-playground-proxy-isolation.test.ts already does: an
      // implementation may rely on the CSP fallback instead of stating
      // script-src explicitly, and that is an equally conforming policy.
      const explicitScriptSrc = extractDirective(csp, "script-src");
      const scriptSrc = explicitScriptSrc.length > 0 ? explicitScriptSrc : extractDirective(csp, "default-src");
      expect(scriptSrc.length).toBeGreaterThan(0);
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");
      expect(scriptSrc).not.toContain("*");
      expect(scriptSrc.some((token) => /^https?:$/i.test(token))).toBe(false);
      expect(scriptSrc).toContain("'self'");
    });

    test("the built SPA document itself needs no more than 'self' — it references exactly one script, from this origin", async () => {
      // Structural confirmation that script-src 'self' is actually achievable
      // for the shipped bundle, not merely asserted by a header nobody can meet.
      const res = await fetch(`${BASE_URL}/`, { headers: { cookie: sessionCookie }, redirect: "manual" });
      const html = await res.text();
      const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
      expect(scriptTags.length).toBe(1);
      expect(scriptTags[0]).toMatch(/src=["']\/public\//);
      expect(scriptTags[0]).not.toMatch(/^\s*$/);
    });

    test("the login page's script-src (baseline CSP, no scripts of its own) also forbids inline and remote script", async () => {
      const res = await fetch(`${BASE_URL}/passkey`, { redirect: "manual" });
      const csp = res.headers.get("content-security-policy");
      await res.text();
      expect(csp).toBeTruthy();
      if (!csp) return;
      const explicitScriptSrc = extractDirective(csp, "script-src");
      const scriptSrc = explicitScriptSrc.length > 0 ? explicitScriptSrc : extractDirective(csp, "default-src");
      expect(scriptSrc.length).toBeGreaterThan(0);
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");
      expect(scriptSrc).not.toContain("*");
    });
  });

  // ---------------------------------------------------------------------
  // Requirement 3 — framing is controlled on ordinary responses
  // ---------------------------------------------------------------------

  describe("requirement 3: non-/proxy responses refuse framing outright", () => {
    for (const { name, fetchIt } of cases()) {
      test(`${name} sets frame-ancestors 'none' and X-Frame-Options: DENY`, async () => {
        const res = await fetchIt();
        const csp = res.headers.get("content-security-policy");
        await res.text();
        expect(csp).toBeTruthy();
        if (!csp) return;

        const frameAncestors = extractDirective(csp, "frame-ancestors");
        expect(frameAncestors).toEqual(["'none'"]);
        expect((res.headers.get("x-frame-options") ?? "").toUpperCase()).toBe("DENY");
      });
    }

    test("frame-ancestors is not merely present but appears exactly once per response (no duplicate/appended CSP header)", async () => {
      const res = await fetch(`${BASE_URL}/`, { headers: { cookie: sessionCookie }, redirect: "manual" });
      await res.text();
      const cspValues = [...res.headers.entries()].filter(([key]) => key.toLowerCase() === "content-security-policy");
      expect(cspValues.length).toBe(1);
      const occurrences = (cspValues[0]?.[1].match(/frame-ancestors/gi) ?? []).length;
      expect(occurrences).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Requirement 7 — published feeds still work
  // ---------------------------------------------------------------------

  describe("requirement 7: a published feed still serves and parses with the new headers present", () => {
    test("content-type is still an XML/feed type, and the body still parses as the same feed", async () => {
      const res = await fetch(`${BASE_URL}/public/feeds/${feedFixtureId}.xml`, { redirect: "manual" });
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(contentType).toMatch(/xml/);
      expect(body).toBe(feedFixtureXml);
      expect(body).toMatch(/^<\?xml/);
      expect(body).toContain("<rss");
      expect(body).toContain("Security Headers Baseline Fixture");
    });

    test("a feed reader style request (Accept: */*, no cookie, no browser headers) still succeeds", async () => {
      const res = await fetch(`${BASE_URL}/public/feeds/${feedFixtureId}.xml`, {
        redirect: "manual",
        headers: { accept: "*/*" },
      });
      await res.text();
      expect(res.status).toBe(200);
      // Anonymous access must not have been accidentally routed into the
      // auth gate by the new middleware.
      expect(res.headers.get("location")).not.toBe("/passkey");
    });

    test("a nonexistent feed still 404s the same way it did before (static handler, not the auth redirect)", async () => {
      const res = await fetch(`${BASE_URL}/public/feeds/security-headers-baseline-does-not-exist.xml`, {
        redirect: "manual",
      });
      await res.text();
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).not.toBe("/passkey");
    });
  });
});

// -----------------------------------------------------------------------
// Sanity: the directive-name helper used above behaves as expected against
// a hand-built policy string, independent of anything the server returns.
// -----------------------------------------------------------------------

describe("test helper sanity", () => {
  test("directiveNames extracts directive names from a semicolon-delimited policy", () => {
    expect(directiveNames("default-src 'self'; script-src 'self' 'nonce-abc'; frame-ancestors 'none'")).toEqual([
      "default-src",
      "script-src",
      "frame-ancestors",
    ]);
  });
});
