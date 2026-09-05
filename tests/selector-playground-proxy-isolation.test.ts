// TDD slice: p2-selector-playground-isolation
//
// Integration coverage for the server-side surfaces GET /proxy owns per the
// requirements brief: sanitizing untrusted upstream HTML before it reaches
// the browser (requirement 2), a restrictive Content-Security-Policy on the
// playground response (requirement 4), a self-hosted + integrity-pinned
// SelectorGadget asset with no third-party network dependency (requirement
// 3), FlareSolverr configuration no longer traveling in the query string
// (requirement 6), and the outbound fetch policy still gating the target and
// its redirects (requirement 8).
//
// These tests drive the real `utilsRouter` Hono sub-app directly (the same
// pattern already used by tests/source-assistant/routes.test.ts and
// tests/service-connectors/service-connectors.test.ts) rather than the full
// application — /proxy carries no auth-specific logic of its own, auth is a
// separate slice, and hitting the router directly keeps this suite fast and
// focused on the surfaces this slice actually owns.
//
// axios is mocked exactly the way
// tests/service-connectors/service-connectors.test.ts already mocks it: by
// reassigning axios.get/axios.post on the shared module instance, since both
// routes/utils.ts and utilities/feed-config-route-adapter.utility.ts import
// the same "axios" module object. No live network call — third-party or
// otherwise — is made anywhere in this file.
import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { utilsRouter } from "../routes/utils";

const configsDir = "./.tdd-state/_selector-playground-proxy-isolation/configs";
const feedPath = "./.tdd-state/_selector-playground-proxy-isolation/feeds";

// A literal public IP. assertOutboundFetchAllowed() skips DNS resolution
// entirely for literal IPs that aren't in a blocked range (see
// utilities/outbound-fetch-policy.utility.ts step 3), so this target passes
// the outbound policy deterministically without touching DNS or the network
// — axios.get is mocked below regardless, so no request is actually sent.
const PUBLIC_IP_TARGET = "http://1.1.1.1/playground-target";

const originalAxiosGet = axios.get;
const originalAxiosPost = axios.post;

afterEach(() => {
  axios.get = originalAxiosGet;
  axios.post = originalAxiosPost;
});

/** Mocks the direct-fetch path (axiosGetWithPolicyRedirects -> axios.get) to return `html` for any URL, and records every URL requested. */
function mockUpstreamHtml(html: string): string[] {
  const calls: string[] = [];
  axios.get = (async (url: string) => {
    calls.push(url);
    return { status: 200, headers: {}, data: html };
  }) as typeof axios.get;
  return calls;
}

function proxyGet(app: ReturnType<typeof utilsRouter>, url: string, extraQuery = "") {
  return app.request(`/proxy?url=${encodeURIComponent(url)}${extraQuery}`);
}

/**
 * Fails if `marker` appears anywhere a browser would actually execute it:
 * inside a <script> element's text, or inside an on* event-handler
 * attribute's value. Deliberately tolerant of the marker surviving as inert
 * visible text elsewhere in the document — sanitization must neutralize
 * *execution*, not necessarily scrub every trace of attacker-supplied text.
 */
function assertNoExecutableMarker(html: string, marker: string): void {
  const $ = cheerio.load(html);
  let executableOccurrences = 0;
  $("script").each((_, el) => {
    if (($(el).html() || "").includes(marker)) executableOccurrences++;
  });
  $("*").each((_, el) => {
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs || {};
    for (const [name, value] of Object.entries(attribs)) {
      if (/^on/i.test(name) && String(value).includes(marker)) executableOccurrences++;
    }
  });
  expect(executableOccurrences).toBe(0);
}

function extractDirective(csp: string, name: string): string[] {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`, "i").exec(csp);
  if (!match) return [];
  return match[1].trim().split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Requirement 2 — sanitization of untrusted upstream HTML
// ---------------------------------------------------------------------------

describe("GET /proxy — sanitizes untrusted upstream HTML before it reaches the browser (requirement 2)", () => {
  test("sanity control: benign markup survives sanitization intact", async () => {
    mockUpstreamHtml("<html><body><p id='ok'>Hello World</p></body></html>");
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    expect(res.status).toBe(200);
    const $ = cheerio.load(await res.text());
    expect($("#ok").text()).toBe("Hello World");
  });

  test("neutralizes an inline <script> tag", async () => {
    mockUpstreamHtml("<html><body><script>window.__xssInline=1;</script></body></html>");
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    assertNoExecutableMarker(await res.text(), "__xssInline");
  });

  test("neutralizes an inline script regardless of tag-name case variation", async () => {
    mockUpstreamHtml("<html><body><ScRiPt>window.__xssCase=1;</sCriPt></body></html>");
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    assertNoExecutableMarker(await res.text(), "__xssCase");
  });

  test("removes an external <script src> tag pointing at a third-party host", async () => {
    mockUpstreamHtml(
      '<html><body><script src="https://evil.example/x.js"></script></body></html>',
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const $ = cheerio.load(await res.text());
    const externalScripts = $("script")
      .toArray()
      .filter((el) => /evil\.example/i.test($(el).attr("src") || ""));
    expect(externalScripts.length).toBe(0);
  });

  test("strips on* event-handler attributes (attribute-based vector)", async () => {
    mockUpstreamHtml(
      '<html><body><img src="x" onerror="window.__xssAttr=1"></body></html>',
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const html = await res.text();
    assertNoExecutableMarker(html, "__xssAttr");
    const $ = cheerio.load(html);
    $("*").each((_, el) => {
      const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs || {};
      for (const name of Object.keys(attribs)) {
        expect(/^on/i.test(name)).toBe(false);
      }
    });
  });

  test("neutralizes an HTML-entity-encoded javascript: URL", async () => {
    // "jav&#97;script:" decodes to "javascript:" only once the attribute
    // value is HTML-entity-decoded — a sanitizer that string-matches the
    // literal "javascript:" prefix before decoding entities is defeated by
    // this exact vector.
    mockUpstreamHtml(
      '<html><body><a id="evilLink" href="jav&#97;script:window.__xssEntity=1">click</a></body></html>',
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const $ = cheerio.load(await res.text());
    const href = $("#evilLink").attr("href");
    expect(href === undefined || !/^\s*javascript:/i.test(href)).toBe(true);
  });

  test("does not leave a second, split <script> tag behind a naive single-pass strip", async () => {
    // Both tags below are well-formed, independently valid <script>
    // elements under real HTML parsing — this isn't a parser-confusion
    // trick. It defeats a naive non-global/first-match-only
    // `<script>...</script>` regex strip, which removes only the first
    // occurrence and leaves the second, marker-bearing one fully intact and
    // executable.
    mockUpstreamHtml(
      "<html><body><script>/* decoy */</script><script>window.__xssSplit=1;</script></body></html>",
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    assertNoExecutableMarker(await res.text(), "__xssSplit");
  });

  test("removes <base href>", async () => {
    mockUpstreamHtml(
      '<html><head><base href="https://evil.example/"></head><body></body></html>',
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const $ = cheerio.load(await res.text());
    expect($("base").length).toBe(0);
  });

  test("removes <form> elements", async () => {
    mockUpstreamHtml(
      '<html><body><form action="https://evil.example/steal"><input name="x"></form></body></html>',
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const $ = cheerio.load(await res.text());
    expect($("form").length).toBe(0);
  });

  test("removes <object>, <embed>, and <applet>", async () => {
    mockUpstreamHtml(
      '<html><body>' +
        '<object data="https://evil.example/x.swf"></object>' +
        '<embed src="https://evil.example/x.swf">' +
        '<applet code="Evil.class"></applet>' +
        "</body></html>",
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const $ = cheerio.load(await res.text());
    expect($("object").length).toBe(0);
    expect($("embed").length).toBe(0);
    expect($("applet").length).toBe(0);
  });

  test("strips srcdoc from iframes", async () => {
    mockUpstreamHtml(
      '<html><body><iframe srcdoc="<script>window.__xssSrcdoc=1</script>"></iframe></body></html>',
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const html = await res.text();
    assertNoExecutableMarker(html, "__xssSrcdoc");
    const $ = cheerio.load(html);
    $("iframe").each((_, el) => {
      const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs || {};
      expect(attribs.srcdoc).toBeUndefined();
    });
  });

  test("neutralizes SVG-borne script", async () => {
    mockUpstreamHtml(
      "<html><body><svg><script>window.__xssSvg=1;</script></svg></body></html>",
    );
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    assertNoExecutableMarker(await res.text(), "__xssSvg");
  });
});

// ---------------------------------------------------------------------------
// Requirement 4 — restrictive Content-Security-Policy
// ---------------------------------------------------------------------------

describe("GET /proxy — sets a restrictive Content-Security-Policy (requirement 4)", () => {
  test("CSP forbids third-party and wildcard script sources", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeTruthy();
    if (!csp) return;

    const scriptSrc = extractDirective(csp, "script-src").length > 0
      ? extractDirective(csp, "script-src")
      : extractDirective(csp, "default-src");

    expect(scriptSrc.length).toBeGreaterThan(0);
    expect(scriptSrc).not.toContain("*");
    expect(scriptSrc.some((token) => /^https?:$/i.test(token))).toBe(false);
    expect(scriptSrc.some((token) => /cloudfront\.net/i.test(token))).toBe(false);

    const hasBlanketInline = scriptSrc.includes("'unsafe-inline'");
    const hasNonceOrHash = scriptSrc.some(
      (token) => token.startsWith("'nonce-") || token.startsWith("'sha"),
    );
    expect(!hasBlanketInline || hasNonceOrHash).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Requirement 3 — self-hosted, integrity-pinned SelectorGadget
// ---------------------------------------------------------------------------

describe("GET /proxy — SelectorGadget is self-hosted and integrity-pinned (requirement 3)", () => {
  test("no longer references the third-party CloudFront asset", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const html = await res.text();
    expect(html).not.toMatch(/dv0akt2986vzh\.cloudfront\.net/i);
    expect(html).not.toMatch(/cloudfront\.net/i);
  });

  test("no outbound request to the CloudFront host is made while serving the playground", async () => {
    const calls = mockUpstreamHtml("<html><body>ok</body></html>");
    const app = utilsRouter({ configsDir, feedPath });
    await proxyGet(app, PUBLIC_IP_TARGET);
    expect(calls.some((url) => /cloudfront\.net/i.test(url))).toBe(false);
  });

  test("references SelectorGadget with a subresource-integrity hash, served from this router with matching content", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    const html = await res.text();

    expect(html).toMatch(/selectorgadget/i);

    const integrityMatch = html.match(
      /integrity\s*[:=]\s*["']?(sha(256|384|512)-[A-Za-z0-9+/]+=*)/i,
    );
    expect(integrityMatch).toBeTruthy();
    if (!integrityMatch) return;

    const [, integrityValue, bits] = integrityMatch;
    const [, base64Digest] = integrityValue.split("-");

    // The asset reference must be same-origin (relative, or same-host),
    // never an absolute reference to a different host — a third-party CDN
    // pinned by integrity is still a third-party network dependency.
    const srcMatch = html.match(
      /(?:src|\.src)\s*[:=]\s*["']([^"'\s]*selectorgadget[^"'\s]*)["']/i,
    );
    expect(srcMatch).toBeTruthy();
    if (!srcMatch) return;
    const assetPath = srcMatch[1];
    expect(/^https?:\/\//i.test(assetPath)).toBe(false);

    // The asset must actually be reachable from this router at the
    // referenced path, and its real bytes must hash to the pinned value —
    // otherwise "integrity-pinned" is decorative.
    const assetRes = await app.request(assetPath);
    expect(assetRes.status).toBe(200);
    const bytes = new Uint8Array(await assetRes.arrayBuffer());
    const nodeAlgo = `sha${bits}`;
    const digest = createHash(nodeAlgo).update(bytes).digest("base64");
    expect(digest).toBe(base64Digest);
  });
});

// ---------------------------------------------------------------------------
// Requirement 6 — FlareSolverr configuration no longer travels in the URL
// ---------------------------------------------------------------------------

describe("GET /proxy — FlareSolverr configuration is not read from the query string (requirement 6)", () => {
  // Uses a literal public IP for the attacker-controlled flaresolverrUrl
  // (rather than a hostname) so assertOutboundFetchAllowed's literal-IP path
  // is taken and no live DNS lookup happens — see
  // utilities/outbound-fetch-policy.utility.ts step 3. This keeps the test
  // deterministic regardless of network access in the test environment.
  test("a flaresolverrUrl/flaresolverrTimeout query parameter is not used to make an outbound FlareSolverr request", async () => {
    let postCalled = false;
    axios.post = (async () => {
      postCalled = true;
      throw new Error(
        "FlareSolverr must not be invoked from query-string-supplied configuration",
      );
    }) as typeof axios.post;
    mockUpstreamHtml("<html><body>direct-fetch-path</body></html>");

    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(
      app,
      PUBLIC_IP_TARGET,
      `&flaresolverrEnabled=true&flaresolverrUrl=${encodeURIComponent("http://8.8.8.8:8191")}&flaresolverrTimeout=1000`,
    );

    expect(postCalled).toBe(false);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("direct-fetch-path");
  });

  test("an attacker-controlled flaresolverrUrl value in the query string never appears in the response body or headers", async () => {
    mockUpstreamHtml("<html><body>ok</body></html>");
    // Mocked so that if the fix is incomplete and this still reaches
    // axios.post, no real network call is made.
    axios.post = (async () => ({
      status: 200,
      data: { solution: { status: 200, response: "<html><body>flaresolverr-path</body></html>" } },
    })) as typeof axios.post;
    const app = utilsRouter({ configsDir, feedPath });
    const marker = "attacker-canary-marker-9182";
    const res = await proxyGet(
      app,
      PUBLIC_IP_TARGET,
      `&flaresolverrEnabled=true&flaresolverrUrl=${encodeURIComponent(`http://8.8.8.8:8191/${marker}`)}`,
    );
    const html = await res.text();
    expect(html.includes(marker)).toBe(false);
    for (const [, value] of res.headers) {
      expect(value.includes(marker)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 8 — outbound fetch policy still gates the target and redirects
// ---------------------------------------------------------------------------

describe("GET /proxy — the outbound fetch policy still gates the target and its redirects (requirement 8)", () => {
  test("rejects a policy-blocked target with 403", async () => {
    const app = utilsRouter({ configsDir, feedPath });
    const res = await app.request(
      `/proxy?url=${encodeURIComponent("http://127.0.0.1/internal")}`,
    );
    expect(res.status).toBe(403);
  });

  test("re-applies the policy to a redirect target, not only the initial URL", async () => {
    axios.get = (async (url: string) => {
      if (url === PUBLIC_IP_TARGET) {
        return {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
          data: "",
        };
      }
      throw new Error(`Unexpected fetch of ${url}`);
    }) as typeof axios.get;

    const app = utilsRouter({ configsDir, feedPath });
    const res = await proxyGet(app, PUBLIC_IP_TARGET);
    expect(res.status).toBe(403);
  });
});
