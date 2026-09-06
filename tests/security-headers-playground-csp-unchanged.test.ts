// TDD slice: p2-csp-security-headers
//
// Integration coverage for requirement 6: the app-wide security-header
// middleware this slice introduces must not replace, append to, or relax
// the Selector Playground's own Content-Security-Policy on GET /proxy
// (routes/utils.ts:321-323, owned and locked by
// p2-selector-playground-isolation). A regression here must be caught by
// this slice's own suite, not discovered later in the other one.
//
// Imports the *actual* production entry point and calls its exported
// `fetch` handler directly — the same technique
// tests/auth-connection-info-boundary.test.ts uses — so the full app-wide
// middleware stack genuinely runs in front of /proxy, not a bare
// `utilsRouter` mounted in isolation. That is the only way to prove the
// app-wide middleware (mounted in index.ts, outside this slice's route
// files) leaves this specific response alone; exercising `utilsRouter`
// directly, the way
// tests/selector-playground-proxy-isolation.test.ts does for its own
// concerns, would not touch the app-wide middleware at all and could pass
// even if that middleware clobbered the header.
//
// axios is mocked exactly the way the locked isolation suite already mocks
// it (reassigning axios.get on the shared module instance) so no live
// network call is made to any host, third-party or otherwise. The proxy
// target itself is a literal public IP for the same reason that file uses
// one: assertOutboundFetchAllowed() skips DNS resolution for literal IPs
// outside blocked ranges, keeping the outbound policy check deterministic
// without touching the network — and axios.get is mocked regardless, so no
// request is actually sent even to that address.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import axios from "axios";

type FetchHandler = (req: Request, env?: unknown) => Promise<Response>;

const LOCAL_ENV = { requestIP: () => ({ address: "203.0.113.77", family: "IPv4", port: 4000 }) };
const PUBLIC_IP_TARGET = "http://1.1.1.1/security-headers-playground-check";

const originalAxiosGet = axios.get;
afterEach(() => {
  axios.get = originalAxiosGet;
});

function mockUpstreamHtml(html: string): void {
  axios.get = (async () => ({ status: 200, headers: {}, data: html })) as typeof axios.get;
}

function extractDirective(csp: string, name: string): string[] {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`, "i").exec(csp);
  if (!match) return [];
  return match[1].trim().split(/\s+/).filter(Boolean);
}

function directiveNamesOf(csp: string): string[] {
  return csp
    .split(";")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map((name) => name.toLowerCase())
    .sort();
}

const LOCKED_PLAYGROUND_DIRECTIVE_NAMES = [
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "frame-src",
  "object-src",
  "base-uri",
  "form-action",
].sort();

describe("app-wide security headers do not alter the locked Selector Playground CSP (requirement 6)", () => {
  let appFetch: FetchHandler;
  let sessionCookie: string;

  beforeAll(async () => {
    process.env.PASSKEY = "security-headers-playground-csp-test-passkey";
    process.env.COOKIE_SECRET = "security-headers-playground-csp-cookie-secret-32c";
    process.env.ENCRYPTION_KEY = "security-headers-playground-csp-encrypt-key-32chr";
    process.env.RUNTIME_DB_PATH = "./.tdd-state/_security-headers-playground-csp-db/runtime.db";
    const mod = (await import(`../index.ts?security-headers-playground-csp=${Date.now()}`)) as {
      default: { fetch: FetchHandler };
    };
    appFetch = mod.default.fetch;

    const loginRes = await appFetch(
      new Request("http://mkfd.test/passkey", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `passkey=${encodeURIComponent(process.env.PASSKEY ?? "")}`,
      }),
      LOCAL_ENV,
    );
    const setCookies = loginRes.headers
      .getSetCookie()
      .filter((entry) => entry.toLowerCase().startsWith("session="));
    await loginRes.body?.cancel();
    if (setCookies.length === 0) throw new Error("login did not set a session cookie");
    sessionCookie = setCookies[setCookies.length - 1].split(";")[0].trim();
  }, 30000);

  async function fetchProxy(): Promise<Response> {
    return appFetch(
      new Request(`http://mkfd.test/proxy?url=${encodeURIComponent(PUBLIC_IP_TARGET)}`, {
        headers: { cookie: sessionCookie },
      }),
      LOCAL_ENV,
    );
  }

  test("GET /proxy through the full app carries exactly the locked directive set — nothing appended, nothing dropped", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    const res = await fetchProxy();
    const csp = res.headers.get("content-security-policy");
    await res.text();

    expect(csp).toBeTruthy();
    if (!csp) return;

    expect(directiveNamesOf(csp)).toEqual(LOCKED_PLAYGROUND_DIRECTIVE_NAMES);
  });

  test("GET /proxy's individual directive values are unchanged from the locked policy", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    const res = await fetchProxy();
    const csp = res.headers.get("content-security-policy");
    await res.text();

    expect(csp).toBeTruthy();
    if (!csp) return;

    expect(extractDirective(csp, "default-src")).toEqual(["'self'"]);
    expect(extractDirective(csp, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(extractDirective(csp, "img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(extractDirective(csp, "font-src")).toEqual(["'self'", "data:"]);
    expect(extractDirective(csp, "connect-src")).toEqual(["'self'"]);
    expect(extractDirective(csp, "frame-src")).toEqual(["'none'"]);
    expect(extractDirective(csp, "object-src")).toEqual(["'none'"]);
    expect(extractDirective(csp, "base-uri")).toEqual(["'none'"]);
    expect(extractDirective(csp, "form-action")).toEqual(["'none'"]);

    // script-src must still be exactly 'self' plus the per-request nonce —
    // no unsafe-inline, no unsafe-eval, no widened source list.
    const scriptSrc = extractDirective(csp, "script-src");
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc.some((token) => token.startsWith("'nonce-"))).toBe(true);
  });

  test("the CSP header appears exactly once on the /proxy response (not merged/duplicated by the app-wide middleware)", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    const res = await fetchProxy();
    await res.text();
    const cspHeaderEntries = [...res.headers.entries()].filter(
      ([key]) => key.toLowerCase() === "content-security-policy",
    );
    expect(cspHeaderEntries.length).toBe(1);
  });

  test("GET /proxy keeps its own X-Content-Type-Options and Referrer-Policy values (not substituted by app-wide defaults)", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    const res = await fetchProxy();
    await res.text();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  test("GET /proxy never receives X-Frame-Options: DENY — that would break same-origin embedding the shipped Selector Playground depends on", async () => {
    // This is the explicit, documented exception the anti-bypass rules
    // permit ("if a route genuinely needs a different policy, it must say
    // so explicitly and the test must assert the difference"): every other
    // response kind is proven to receive X-Frame-Options: DENY in
    // tests/security-headers-baseline.test.ts, but /proxy is framed by this
    // app's own Selector Playground
    // (frontend/e2e/selector-playground-isolation.spec.ts, locked) and must
    // remain frameable from its own origin.
    mockUpstreamHtml("<html><body>ok</body></html>");
    const res = await fetchProxy();
    await res.text();
    const xfo = res.headers.get("x-frame-options");
    if (xfo) expect(xfo.toUpperCase()).not.toBe("DENY");
  });

  test("a differently-shaped upstream document (nonce-bearing SelectorGadget bootstrap) still receives the identical locked directive set", async () => {
    // Guards against an implementation that only preserves the header for a
    // trivial body and coincidentally rebuilds/loses it once the real
    // SelectorGadget-injecting code path runs.
    mockUpstreamHtml("<html><body><p>real-shaped upstream document</p></body></html>");
    const res = await fetchProxy();
    const csp = res.headers.get("content-security-policy");
    const html = await res.text();
    expect(html).toMatch(/selectorgadget/i);
    expect(csp).toBeTruthy();
    if (!csp) return;
    expect(directiveNamesOf(csp)).toEqual(LOCKED_PLAYGROUND_DIRECTIVE_NAMES);
  });
});
