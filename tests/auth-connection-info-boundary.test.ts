// Integration coverage for slice p2-auth-trust-boundary: the parts of
// requirement 1, 2, and 8 that cannot be exercised over a real TCP socket
// (a real client connection always has a determinate, real source address).
//
// This imports the *actual* production entry point and calls its exported
// `fetch` handler directly — the same function Bun.serve calls in
// production (`export default { fetch: app.fetch }` in index.ts). That
// handler is a lexically-bound arrow function on the real Hono app
// instance, so calling it detached like this exercises the real mount
// order, middleware stack, and route exceptions; it is not a
// reimplementation of the auth middleware. The only thing under test
// control is the second argument (`env`), which is exactly what Hono's
// `getConnInfo(c)` reads via `hono/bun`'s adapter to determine the peer
// address — the same shape Bun's own server object has.
import { beforeAll, describe, expect, test } from "bun:test";

type FetchHandler = (req: Request, env?: unknown) => Promise<Response>;

let appFetch: FetchHandler;

beforeAll(async () => {
  process.env.PASSKEY = "conninfo-boundary-test-passkey";
  process.env.COOKIE_SECRET = "conninfo-boundary-cookie-secret-32-chars";
  process.env.ENCRYPTION_KEY = "conninfo-boundary-encrypt-key-32-chars";
  process.env.RUNTIME_DB_PATH = "./.tdd-state/_auth-conninfo-boundary-db/runtime.db";
  // Cache-bust so this module's top-level side effects run once, isolated
  // to this file's env, regardless of any other test file.
  const mod = (await import(`../index.ts?auth-conninfo-boundary=${Date.now()}`)) as {
    default: { fetch: FetchHandler };
  };
  appFetch = mod.default.fetch;
}, 30000);

function anonymousGet(headers: Record<string, string> = {}): Request {
  return new Request("http://mkfd.test/", { method: "GET", headers });
}

async function isGrantedAccess(res: Response): Promise<boolean> {
  if (res.status !== 200) return false;
  const body = await res.text();
  return body.includes('id="root"');
}

describe("connection-info trust boundary (requirements 1, 2, 8)", () => {
  test("an indeterminate peer address (server.requestIP returns null) must not grant access", async () => {
    // This is the literal shipped defect at index.ts:151-153:
    // `!connInfo?.remote?.address` currently evaluates to true here, and
    // the request is treated as local.
    const env = { requestIP: () => null };
    const res = await appFetch(anonymousGet(), env);
    expect(await isGrantedAccess(res)).toBe(false);
  });

  test("a private Docker-bridge-shaped peer address must not grant access", async () => {
    // Guards against a naive fix that widens the trusted set from the
    // hardcoded loopback list to "any private/internal address" instead of
    // removing address-based trust entirely.
    const env = { requestIP: () => ({ address: "172.18.0.1", family: "IPv4", port: 4000 }) };
    const res = await appFetch(anonymousGet(), env);
    expect(await isGrantedAccess(res)).toBe(false);
  });

  test("a real loopback peer address must not grant access", async () => {
    const env = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 4000 }) };
    const res = await appFetch(anonymousGet(), env);
    expect(await isGrantedAccess(res)).toBe(false);
  });

  test("an ::1 loopback peer address must not grant access", async () => {
    const env = { requestIP: () => ({ address: "::1", family: "IPv6", port: 4000 }) };
    const res = await appFetch(anonymousGet(), env);
    expect(await isGrantedAccess(res)).toBe(false);
  });

  test("any error while reading connection info fails closed, never next()", async () => {
    const env = { requestIP: () => { throw new Error("boom"); } };
    let granted: boolean;
    try {
      granted = await isGrantedAccess(await appFetch(anonymousGet(), env));
    } catch {
      // An uncaught error propagating out of the middleware chain never
      // reaches next(), so access was not granted either way.
      granted = false;
    }
    expect(granted).toBe(false);
  });

  test("a missing/malformed server env fails closed", async () => {
    let granted: boolean;
    try {
      granted = await isGrantedAccess(await appFetch(anonymousGet(), {}));
    } catch {
      granted = false;
    }
    expect(granted).toBe(false);
  });

  test("a forged X-Forwarded-For header does not change the authorization outcome", async () => {
    // Requirement 8: any forwarded-address parsing must be observability
    // only. A public, non-local peer address is used so that neither
    // outcome could be attributed to genuine loopback trust.
    const env = { requestIP: () => ({ address: "203.0.113.9", family: "IPv4", port: 4000 }) };

    const withoutForgedHeader = await appFetch(anonymousGet(), env);
    const withoutOutcome = await isGrantedAccess(withoutForgedHeader);

    const withForgedHeader = await appFetch(
      anonymousGet({ "x-forwarded-for": "127.0.0.1" }),
      env,
    );
    const withOutcome = await isGrantedAccess(withForgedHeader);

    expect(withoutOutcome).toBe(false);
    expect(withOutcome).toBe(false);
  });
});

describe("session cookie Secure attribute derives from the request, not the SSL startup flag (requirement 7)", () => {
  // Two separately-imported app instances, one started with the SSL startup
  // flag off and one with it on, so tests can prove the Secure attribute
  // tracks the actual request (scheme, or a trusted proxy's forwarded
  // proto) rather than that static flag. A publicly-routable, non-local
  // peer address is used throughout so no outcome could be attributed to
  // loopback trust.
  let appFetchSslFalse: FetchHandler;
  let appFetchSslTrue: FetchHandler;
  const nonLocalEnv = { requestIP: () => ({ address: "203.0.113.9", family: "IPv4", port: 4000 }) };

  beforeAll(async () => {
    process.env.PASSKEY = "conninfo-boundary-cookie-test-passkey";
    process.env.COOKIE_SECRET = "conninfo-boundary-cookie-secret-32-charsB";
    process.env.ENCRYPTION_KEY = "conninfo-boundary-encrypt-key-32-charsB";

    process.env.RUNTIME_DB_PATH = "./.tdd-state/_auth-conninfo-cookie-ssl-false-db/runtime.db";
    delete process.env.SSL;
    const modSslFalse = (await import(`../index.ts?auth-conninfo-cookie-ssl-false=${Date.now()}`)) as {
      default: { fetch: FetchHandler };
    };
    appFetchSslFalse = modSslFalse.default.fetch;

    process.env.RUNTIME_DB_PATH = "./.tdd-state/_auth-conninfo-cookie-ssl-true-db/runtime.db";
    process.env.SSL = "true";
    const modSslTrue = (await import(`../index.ts?auth-conninfo-cookie-ssl-true=${Date.now()}`)) as {
      default: { fetch: FetchHandler };
    };
    appFetchSslTrue = modSslTrue.default.fetch;
    delete process.env.SSL;
  }, 30000);

  async function setCookieFor(
    fetchHandler: FetchHandler,
    url: string,
    headers: Record<string, string>,
  ): Promise<string> {
    // GET /passkey is the one path every client — authenticated or not,
    // local-looking or not — must always be able to reach, and
    // sessionMiddleware issues a cookie on every response regardless of
    // route, so this exercises the cookie contract without depending on a
    // working login flow.
    const res = await fetchHandler(new Request(url, { method: "GET", headers }), nonLocalEnv);
    const setCookie = res.headers.get("set-cookie");
    await res.body?.cancel();
    if (!setCookie) throw new Error("Response did not set a session cookie");
    return setCookie;
  }

  test("a direct HTTPS request gets a Secure cookie even when the SSL startup flag is false", async () => {
    const setCookie = await setCookieFor(appFetchSslFalse, "https://mkfd.test/passkey", {});
    expect(setCookie).toMatch(/;\s*Secure/i);
  });

  test("a plain HTTP request does not get a Secure cookie even when the SSL startup flag is true", async () => {
    const setCookie = await setCookieFor(appFetchSslTrue, "http://mkfd.test/passkey", {});
    expect(setCookie).not.toMatch(/;\s*Secure/i);
  });

  test("a forged X-Forwarded-Proto: https from a peer that is not a configured trusted proxy does not grant a Secure cookie", async () => {
    // Otherwise any client could trick the server into issuing a cookie the
    // browser will then refuse to send back over plain HTTP, locking the
    // user out.
    const setCookie = await setCookieFor(appFetchSslFalse, "http://mkfd.test/passkey", {
      "x-forwarded-proto": "https",
    });
    expect(setCookie).not.toMatch(/;\s*Secure/i);
  });

  test("a forged X-Forwarded-Proto header does not change the authorization outcome", async () => {
    // Requirement 8: forwarded headers may inform transport/cookie
    // decisions from a trusted proxy, but must never feed authorization.
    const without = await appFetchSslFalse(anonymousGet(), nonLocalEnv);
    const withoutOutcome = await isGrantedAccess(without);

    const withForged = await appFetchSslFalse(anonymousGet({ "x-forwarded-proto": "https" }), nonLocalEnv);
    const withOutcome = await isGrantedAccess(withForged);

    expect(withoutOutcome).toBe(false);
    expect(withOutcome).toBe(false);
  });
});
