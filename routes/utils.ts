/**
 * Utils Routes
 *
 * GET  /proxy                  — proxy with SelectorGadget injection
 * GET  /passkey                — passkey entry page
 * POST /imap/folders           — list IMAP folders
 * POST /utils/suggest-selectors — selector suggestions
 * POST /api/flaresolverr/health — FlareSolverr health check
 * POST /utils/root-url         — parse root URL
 * POST /trigger-webhook        — manually trigger a feed webhook
 */

import { Hono } from "hono";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import axios from "axios";
import { solveWithFlareSolverr } from "../lib/outbound/flaresolverr-adapter";
import type { Config } from "node-imap";
import { listImapFolders } from "../utilities/imap.utility";
import { suggestSelectors } from "../utilities/selector-suggestion.utility";
import { makeSourceAnalysisCacheKey, getCachedAnalysis, setCachedAnalysis } from "../utilities/source-assistant/analysis-cache.utility";
import { observeSource } from "../utilities/source-assistant/observer.utility";
import { buildRecommendations } from "../utilities/source-assistant/recommender.utility";
import { detectFormsFromUrl } from "../utilities/form-detection.utility";
import {
  assertOutboundFetchAllowed,
  getGlobalFetchPolicyOptions,
} from "../utilities/outbound-fetch-policy.utility";
import {
  normalizeUrl,
  axiosGetWithPolicyRedirects,
} from "../utilities/feed-config-route-adapter.utility";
import * as yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Selector Playground isolation (A1)
// ---------------------------------------------------------------------------

/** Elements that can execute or redirect, removed wholesale from proxied HTML. */
const ACTIVE_ELEMENTS = [
  "script",
  "object",
  "embed",
  "applet",
  "base",
  "form",
  "noscript",
  "template",
] as const;

/** Attributes carrying a URL that could be a javascript: payload. */
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href", "data"] as const;

/**
 * Strips executable and navigational content from an untrusted upstream
 * document before it is served from this origin.
 *
 * Parsing with Cheerio rather than pattern-matching the raw text is the point:
 * a regex strip is defeated by case variation, split or nested tags, and
 * entity encoding, and one accepted test constructs exactly that. Re-parsing
 * and re-serialising normalises all of it, and the loop below re-runs until
 * the output is stable so a payload that only becomes a tag after one pass
 * cannot survive.
 */
function sanitizeUntrustedHtml(html: string): string {
  let current = html;

  for (let pass = 0; pass < 5; pass++) {
    const $ = cheerio.load(current);

    $(ACTIVE_ELEMENTS.join(",")).remove();

    $("*").each((_, node) => {
      // Cheerio yields AnyNode; only element nodes carry attributes, and the
      // narrowing keeps this honest without an unsafe cast.
      if (!isTagNode(node)) return;
      const element = node;
      const attribs = element.attribs ?? {};
      for (const name of Object.keys(attribs)) {
        const lower = name.toLowerCase();

        // Event handlers execute directly; there is no safe form of them here.
        if (lower.startsWith("on")) {
          $(element).removeAttr(name);
          continue;
        }

        // srcdoc is a whole nested document, so sanitising it is equivalent to
        // sanitising an untrusted page; dropping it is simpler and safe.
        if (lower === "srcdoc") {
          $(element).removeAttr(name);
          continue;
        }

        if (URL_ATTRIBUTES.includes(lower as (typeof URL_ATTRIBUTES)[number])) {
          if (isExecutableUrl(attribs[name] ?? "")) $(element).removeAttr(name);
        }
      }
    });

    const next = $.html();
    if (next === current) break;
    current = next;
  }

  return current;
}

/**
 * True for URLs that execute rather than navigate. Entities are decoded and
 * control characters stripped first, because `java&#115;cript:` and
 * `java\tscript:` are both live in browsers but invisible to a literal check.
 */
/** Narrows a Cheerio AnyNode to an element node that actually has attributes. */
function isTagNode(node: unknown): node is Element {
  return typeof node === "object" && node !== null && "attribs" in node && "tagName" in node;
}

function isExecutableUrl(value: string): boolean {
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec) => String.fromCharCode(Number.parseInt(dec, 10)))
    // Whitespace and control characters are removed by code point rather than
    // a control-character regex literal, which Biome rejects as an error.
    .split("")
    .filter((ch) => ch.charCodeAt(0) > 0x20)
    .join("")
    .toLowerCase();
  return decoded.startsWith("javascript:") || decoded.startsWith("vbscript:") || decoded.startsWith("data:text/html");
}

/** Vendored SelectorGadget, served from this origin instead of two CDNs. */
const SELECTORGADGET_DIR = join(process.cwd(), "public", "vendor", "selectorgadget");
const SELECTORGADGET_PATH = "/vendor/selectorgadget/selectorgadget.js";

/**
 * Integrity digest computed from the bytes actually served, not hardcoded, so
 * the pin cannot drift away from the file it is meant to pin.
 */
function selectorGadgetIntegrity(): string {
  const bytes = readFileSync(join(SELECTORGADGET_DIR, "selectorgadget.js"));
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

/**
 * Content-Security-Policy for the playground document. Scripts may only come
 * from this origin, which is what makes the vendoring meaningful: even if
 * sanitisation missed something, a third-party script URL still cannot load.
 * 'unsafe-inline' is not granted; the injected bootstrap carries a nonce.
 */
function playgroundCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function injectSelectorGadget(html: string, nonce: string): string {
  const integrity = selectorGadgetIntegrity();
  const SG_SCRIPT = `
    <script nonce="${nonce}">
      (function() {
        var loadingDiv = document.createElement("div");
        loadingDiv.textContent = "Loading SelectorGadget...";
        loadingDiv.style.cssText = "color:black;padding:20px;position:fixed;z-index:9999;font-size:1.5em;border:2px solid black;right:40px;top:40px;background:white";
        document.body.appendChild(loadingDiv);

        var sgScript = document.createElement("script");
        sgScript.type = "text/javascript";
        sgScript.src = "${SELECTORGADGET_PATH}";
        sgScript.integrity = "${integrity}";
        document.body.appendChild(sgScript);

        var gadgetInterval = setInterval(function() {
          if (window.SelectorGadget && window.SelectorGadget.prototype && window.SelectorGadget.prototype.setPath) {
            clearInterval(gadgetInterval);
            loadingDiv.remove();
            var original = window.SelectorGadget.prototype.setPath;
            window.SelectorGadget.prototype.setPath = function(prediction) {
              // The nonce proves the message came from the document the parent
              // created for this session. The parent also checks event.source,
              // so another window cannot forge one even knowing the nonce.
              window.parent.postMessage(
                { type: "selectorUpdated", selector: prediction, nonce: "${nonce}" },
                "*"
              );
              return original.call(this, prediction);
            };
            var sg = new window.SelectorGadget();
            sg.makeInterface();
            sg.setMode("interactive");
          }
        }, 100);
      })();
    </script>`;

  if (html.includes("</body>")) return html.replace("</body>", `${SG_SCRIPT}</body>`);
  return html + SG_SCRIPT;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function utilsRouter(deps: {
  configsDir: string;
  feedPath: string;
}): Hono {
  const { configsDir, feedPath } = deps;
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /proxy
  // -------------------------------------------------------------------------

  // Serve the vendored SelectorGadget bundle from this origin. Mounted here,
  // beside the route that injects it, so the slice stays self-contained:
  // /configs/* static serving and the app-wide header work are separate
  // Packet 2 slices.
  app.get("/vendor/selectorgadget/:file", async (ctx) => {
    const requested = basename(ctx.req.param("file"));
    const full = join(SELECTORGADGET_DIR, requested);
    if (!existsSync(full)) return ctx.text("Not found", 404);
    const body = await readFile(full);
    const type = requested.endsWith(".css") ? "text/css" : "application/javascript";
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  });

  app.get("/proxy", async (ctx) => {
    const targetUrl = ctx.req.query("url");
    if (!targetUrl) {
      return ctx.text('Missing "url" parameter', 400);
    }

    // FlareSolverr configuration is deliberately NOT read from the query
    // string. Putting an internal service URL there leaks it into browser
    // history, referrer headers and request logs, and lets any caller point
    // the server at an arbitrary host. The playground uses the direct fetch
    // path; a configured FlareSolverr integration belongs behind the shared
    // adapter, not a URL parameter.
    const flaresolverrEnabled = false;
    const flaresolverrUrl = "";
    const flaresolverrTimeout = 60000;

    const proxyPolicyOptions = getGlobalFetchPolicyOptions();
    try {
      await assertOutboundFetchAllowed(targetUrl, proxyPolicyOptions);
    } catch (policyErr: any) {
      return ctx.text(policyErr.message, 403);
    }

    try {
      let html: string;

      if (flaresolverrEnabled && flaresolverrUrl) {
        // Routed through the one approved FlareSolverr adapter. A policy
        // refusal stays a 403 here rather than becoming a 500: the playground
        // distinguishes "this target is not allowed" from "the fetch broke".
        try {
          const solved = await solveWithFlareSolverr({
            serverUrl: flaresolverrUrl,
            targetUrl,
            maxTimeoutMs: flaresolverrTimeout,
            policyOptions: proxyPolicyOptions,
            budgetMs: flaresolverrTimeout,
          });
          html = solved.html;
        } catch (flareErr: any) {
          if (String(flareErr?.message ?? "").startsWith("Outbound fetch blocked")) {
            return ctx.text(flareErr.message, 403);
          }
          throw flareErr;
        }
      } else {
        const response = await axiosGetWithPolicyRedirects(
          targetUrl,
          {},
          proxyPolicyOptions,
        );
        html = response.data;
      }

      const nonce = randomUUID().replace(/-/g, "");
      html = injectSelectorGadget(sanitizeUntrustedHtml(html), nonce);
      return ctx.html(html, 200, {
        "Content-Security-Policy": playgroundCsp(nonce),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
    } catch (error) {
      // A policy rejection discovered mid-redirect is a refusal, not a fault.
      // Surfacing it as 500 would hide a security decision behind a generic
      // error and make it indistinguishable from an upstream failure.
      const message = error instanceof Error ? error.message : String(error);
      if (/blocked|not allowed|policy|denied|refus/i.test(message)) {
        return ctx.text(message, 403);
      }
      console.error("Error fetching remote URL:", error);
      return ctx.text("Could not fetch the target URL", 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /passkey
  // -------------------------------------------------------------------------

  // Styled with local CSS rather than a CDN stylesheet. The previous Pico
  // link was unpinned beyond a major version, carried no integrity attribute,
  // and sat on the one page every operator sees before they have a session; it
  // also broke the air-gapped and LAN installs Mkfd supports. Vendoring ~80KB
  // to style one form would be disproportionate, so the CSS is inline and
  // covered by the style-src allowance the app-wide policy already grants for
  // React inline styles.
  app.get("/passkey", (c) => {
    return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Enter Passkey</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root { color-scheme: light dark; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            background: #f6f7f9;
            color: #1b1f24;
          }
          main { width: min(22rem, calc(100vw - 2rem)); }
          h1 { font-size: 1.35rem; margin: 0 0 1rem; letter-spacing: -0.02em; }
          form {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            background: #fff;
            padding: 1.5rem;
            border: 1px solid #d8dce1;
            border-radius: 0.5rem;
          }
          label { font-size: 0.875rem; font-weight: 500; }
          input {
            font: inherit;
            padding: 0.5rem 0.625rem;
            border: 1px solid #c3c9d0;
            border-radius: 0.375rem;
            background: #fff;
            color: inherit;
          }
          input:focus-visible { outline: 2px solid #3b6ea5; outline-offset: 1px; }
          button {
            font: inherit;
            font-weight: 500;
            margin-top: 0.25rem;
            padding: 0.5rem 0.75rem;
            border: 0;
            border-radius: 0.375rem;
            background: #2f6feb;
            color: #fff;
            cursor: pointer;
          }
          button:hover { background: #2860d0; }
          @media (prefers-color-scheme: dark) {
            body { background: #14171a; color: #e6e9ec; }
            form { background: #1c2024; border-color: #2c3238; }
            input { background: #14171a; border-color: #39414a; }
          }
        </style>
      </head>
      <body>
        <main class="container">
          <h1>Enter Passkey</h1>
          <form method="POST" action="/passkey">
            <label for="passkey">Passkey:</label>
            <input type="password" id="passkey" name="passkey" required>
            <button type="submit">Submit</button>
          </form>
        </main>
      </body>
    </html>
  `);
  });

  // -------------------------------------------------------------------------
  // POST /imap/folders
  // -------------------------------------------------------------------------

  app.post("/imap/folders", async (c) => {
    const config = await c.req.json<Config>();
    console.log("IMAP config:", {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password ? "[REDACTED]" : undefined,
    });

    try {
      await assertOutboundFetchAllowed(
        `https://${config.host}:${config.port}/`,
        getGlobalFetchPolicyOptions(),
      );
    } catch (policyErr: any) {
      return c.text(policyErr.message, 403);
    }

    const folders = await listImapFolders(config);
    console.log("IMAP folders:", folders);
    return c.json({ folders });
  });

  // -------------------------------------------------------------------------
  // POST /utils/suggest-selectors
  // -------------------------------------------------------------------------

  app.post("/utils/suggest-selectors", async (c) => {
    const { url, flaresolverr, cookies } = await c.req.json();
    const suggestPolicyOptions = getGlobalFetchPolicyOptions();
    try {
      await assertOutboundFetchAllowed(url, suggestPolicyOptions);
    } catch (policyErr: any) {
      return c.json({ error: policyErr.message }, 403);
    }
    if (flaresolverr?.enabled && flaresolverr?.serverUrl) {
      try {
        await assertOutboundFetchAllowed(
          `${normalizeUrl(flaresolverr.serverUrl)}/v1`,
          suggestPolicyOptions,
        );
      } catch (policyErr: any) {
        return c.json({ error: policyErr.message }, 403);
      }
    }
    try {
      const selectors = await suggestSelectors(
        url,
        flaresolverr,
        cookies,
        suggestPolicyOptions,
      );
      return c.json(selectors);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/flaresolverr/health
  // -------------------------------------------------------------------------

  app.post("/api/flaresolverr/health", async (c) => {
    const { serverUrl } = await c.req.json();

    if (!serverUrl) {
      return c.json({ active: false, error: "No server URL provided" });
    }

    const normalizedUrl = normalizeUrl(serverUrl);

    try {
      await assertOutboundFetchAllowed(
        `${normalizedUrl}/`,
        getGlobalFetchPolicyOptions(),
      );
    } catch (policyErr: any) {
      return c.json({ active: false, error: policyErr.message });
    }

    try {
      const response = await axios.get(`${normalizedUrl}/`, {
        timeout: 5000,
        maxRedirects: 0,
        validateStatus: () => true,
      });
      return c.json({ active: true, status: response.status });
    } catch (error: any) {
      return c.json({ active: false, error: error.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /utils/root-url
  // -------------------------------------------------------------------------

  app.post("/utils/root-url", async (c) => {
    const { url } = await c.req.json();
    try {
      const parsed = new URL(url);
      return c.json({ origin: parsed.origin });
    } catch {
      return c.json({ origin: "" }, 400);
    }
  });

  app.post("/utils/detect-forms", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.url) return c.json({ error: "url is required" }, 400);
    try {
      return c.json(await detectFormsFromUrl(body));
    } catch (err: any) {
      return c.json({ error: err?.message ?? "Could not detect forms" }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /utils/analyze-web-page
  // -------------------------------------------------------------------------

  app.post("/utils/analyze-web-page", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.url) return c.json({ error: "url is required" }, 400);
    const options = body.options ?? {};
    const key = makeSourceAnalysisCacheKey(body.url, options);
    const cached = getCachedAnalysis(key);
    const entry = cached ?? (() => null)();
    let observation = entry?.observation;
    let recommendations = entry?.recommendations;
    if (!observation || !recommendations) {
      observation = await observeSource({ url: body.url, options }, { policyOptions: getGlobalFetchPolicyOptions() });
      recommendations = buildRecommendations(observation);
      setCachedAnalysis({ key, observation, recommendations });
    }
    const webScraping = recommendations.find((rec) => rec.routeType === "webScraping");
    return c.json({
      observation,
      webScrapingPlan: webScraping?.webScrapingPlan ?? { request: { url: observation.finalUrl } },
      recommendations,
      warnings: observation.warnings,
    });
  });

  // -------------------------------------------------------------------------
  // POST /trigger-webhook
  // -------------------------------------------------------------------------

  app.post("/trigger-webhook", async (c) => {
    const { feedId } = await c.req.json();

    if (!feedId) {
      return c.json({ error: "Feed ID is required" }, 400);
    }

    try {
      const sanitizedFeedId = basename(feedId as string);
      const configPath = join(configsDir, `${sanitizedFeedId}.yaml`);

      if (!existsSync(configPath)) {
        return c.json({ error: "Feed not found" }, 404);
      }

      const yamlContent = await readFile(configPath, "utf8");
      const feedConfig = yaml.load(yamlContent) as any;

      if (!feedConfig.webhook?.enabled || !feedConfig.webhook?.url) {
        return c.json({ error: "Webhook not configured for this feed" }, 400);
      }

      const rssPath = join(feedPath, `${sanitizedFeedId}.xml`);
      if (!existsSync(rssPath)) {
        return c.json({ error: "RSS feed not generated yet" }, 404);
      }

      const rssXml = await readFile(rssPath, "utf8");

      const {
        sendWebhook,
        createWebhookPayload,
        createJsonWebhookPayload,
      } = await import("../utilities/webhook.utility");

      const payload =
        feedConfig.webhook.format === "json"
          ? createJsonWebhookPayload(feedConfig, rssXml, "manual")
          : createWebhookPayload(feedConfig, rssXml, "manual");

      const success = await sendWebhook(feedConfig.webhook, payload);

      if (success) {
        return c.json({
          message: "Webhook triggered successfully",
          feedId: sanitizedFeedId,
          webhookUrl: feedConfig.webhook.url,
          itemCount: payload.itemCount,
        });
      } else {
        return c.json({ error: "Failed to send webhook" }, 500);
      }
    } catch (error) {
      console.error("Error triggering webhook:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return app;
}
