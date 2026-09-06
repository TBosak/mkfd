// TDD slice: p2-csp-security-headers
//
// Integration coverage for requirement 5: Strict-Transport-Security is sent
// only when the connection is actually HTTPS, derived the same way the
// `Secure` cookie decision already is (index.ts:154, requestIsSecure — from
// the request URL's protocol, never the `SSL` startup flag or an untrusted
// forwarded header). A plain-HTTP LAN install must never receive HSTS: doing
// so would make the app unreachable over plain HTTP for the max-age.
//
// Imports the *actual* production entry point and calls its exported
// `fetch` handler directly, the same technique
// tests/auth-connection-info-boundary.test.ts already uses, so the request's
// scheme (via the Request URL) is fully under test control without needing a
// real TLS-terminating listener. Each `describe` block below re-imports
// index.ts with a cache-busting query string and its own RUNTIME_DB_PATH,
// exactly like the existing SSL-flag-vs-connection test in that file, so the
// two SSL-startup-flag values genuinely come from two separately-started app
// instances rather than a mutated shared one.
import { beforeAll, describe, expect, test } from "bun:test";

type FetchHandler = (req: Request, env?: unknown) => Promise<Response>;

// A publicly-routable, non-local peer address throughout, matching the
// existing conninfo-boundary test's convention, so no outcome here could be
// attributed to loopback/dev-bypass trust rather than the HSTS logic itself.
const NON_LOCAL_ENV = { requestIP: () => ({ address: "203.0.113.44", family: "IPv4", port: 4000 }) };

async function importFreshApp(cacheBustKey: string): Promise<FetchHandler> {
  const mod = (await import(`../index.ts?${cacheBustKey}=${Date.now()}`)) as {
    default: { fetch: FetchHandler };
  };
  return mod.default.fetch;
}

/** GET /passkey is reachable by every client regardless of auth state, and the app-wide header middleware must run on it the same as anywhere else. */
async function fetchPasskeyPage(fetchHandler: FetchHandler, url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetchHandler(new Request(url, { method: "GET", headers }), NON_LOCAL_ENV);
  await res.text();
  return res;
}

describe("HSTS with the SSL startup flag off (requirement 5)", () => {
  let appFetch: FetchHandler;

  beforeAll(async () => {
    process.env.PASSKEY = "security-headers-hsts-off-test-passkey";
    process.env.COOKIE_SECRET = "security-headers-hsts-off-cookie-secret-32-chars";
    process.env.ENCRYPTION_KEY = "security-headers-hsts-off-encrypt-key-32-chars";
    process.env.RUNTIME_DB_PATH = "./.tdd-state/_security-headers-hsts-off-db/runtime.db";
    delete process.env.SSL;
    appFetch = await importFreshApp("security-headers-hsts-off");
  }, 30000);

  test("a genuine HTTPS request receives Strict-Transport-Security, even though the SSL startup flag is off", async () => {
    const res = await fetchPasskeyPage(appFetch, "https://mkfd.test/passkey");
    const hsts = res.headers.get("strict-transport-security");
    expect(hsts).toBeTruthy();
    if (!hsts) return;
    expect(hsts).toMatch(/max-age=\d+/i);
    const maxAgeMatch = /max-age=(\d+)/i.exec(hsts);
    expect(maxAgeMatch).toBeTruthy();
    if (maxAgeMatch) expect(Number(maxAgeMatch[1])).toBeGreaterThan(0);
  });

  test("a plain HTTP request does not receive Strict-Transport-Security, even though other baseline headers are present", async () => {
    const res = await fetchPasskeyPage(appFetch, "http://mkfd.test/passkey");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    // Guards against a broken implementation that dropped the whole
    // middleware for plain HTTP instead of selectively withholding HSTS.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  test("a forged X-Forwarded-Proto: https from an unconfigured/untrusted peer does not grant HSTS over a plain HTTP request", async () => {
    // Mirrors the existing Secure-cookie forgery guard in
    // tests/auth-connection-info-boundary.test.ts: there is no trusted-proxy
    // configuration surface, so honouring this header unconditionally would
    // let any client force HSTS onto a plain-HTTP LAN install, potentially
    // making it unreachable for the max-age.
    const res = await fetchPasskeyPage(appFetch, "http://mkfd.test/passkey", { "x-forwarded-proto": "https" });
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("HSTS with the SSL startup flag on (requirement 5 — must not be derived from the flag)", () => {
  let appFetch: FetchHandler;

  beforeAll(async () => {
    process.env.PASSKEY = "security-headers-hsts-on-test-passkey";
    process.env.COOKIE_SECRET = "security-headers-hsts-on-cookie-secret-32-chars";
    process.env.ENCRYPTION_KEY = "security-headers-hsts-on-encrypt-key-32-chars";
    process.env.RUNTIME_DB_PATH = "./.tdd-state/_security-headers-hsts-on-db/runtime.db";
    process.env.SSL = "true";
    appFetch = await importFreshApp("security-headers-hsts-on");
    delete process.env.SSL;
  }, 30000);

  test("a plain HTTP request does not receive Strict-Transport-Security, even though the SSL startup flag is true", async () => {
    // This is the literal scenario the brief calls out: a plain-HTTP LAN
    // install that also happens to run with SSL=true (or has it left over
    // from another deployment's env) must remain reachable — sending HSTS
    // here would tell the browser to refuse plain HTTP to this host for the
    // max-age, locking every visitor out.
    const res = await fetchPasskeyPage(appFetch, "http://mkfd.test/passkey");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  test("a genuine HTTPS request still receives Strict-Transport-Security", async () => {
    const res = await fetchPasskeyPage(appFetch, "https://mkfd.test/passkey");
    expect(res.headers.get("strict-transport-security")).toBeTruthy();
  });
});
