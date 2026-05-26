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
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import axios from "axios";
import type { Config } from "node-imap";
import { listImapFolders } from "../utilities/imap.utility";
import { suggestSelectors } from "../utilities/suggestion-engine.utility";
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

function injectSelectorGadget(html: string): string {
  const SG_SCRIPT = `
    <script>
      (function() {
        let loadingDiv = document.createElement("div");
        loadingDiv.innerHTML = "Loading SelectorGadget...";
        loadingDiv.style.color = "black";
        loadingDiv.style.padding = "20px";
        loadingDiv.style.position = "fixed";
        loadingDiv.style.zIndex = "9999";
        loadingDiv.style.fontSize = "1.5em";
        loadingDiv.style.border = "2px solid black";
        loadingDiv.style.right = "40px";
        loadingDiv.style.top = "40px";
        loadingDiv.style.background = "white";
        document.body.appendChild(loadingDiv);

        let sgScript = document.createElement("script");
        sgScript.type = "text/javascript";
        sgScript.src = "https://dv0akt2986vzh.cloudfront.net/stable/lib/selectorgadget.js";
        document.body.appendChild(sgScript);

        let gadgetInterval = setInterval(() => {
          if (
            window.SelectorGadget &&
            window.SelectorGadget.prototype &&
            window.SelectorGadget.prototype.setPath
          ) {
            clearInterval(gadgetInterval);
            loadingDiv.remove();

            const original = window.SelectorGadget.prototype.setPath;
            window.SelectorGadget.prototype.setPath = function(prediction) {
              console.log("Intercepted setPath:", prediction);
              window.parent.postMessage({ type: "selectorUpdated", selector: prediction }, "*");
              return original.call(this, prediction);
            };

            let sg = new window.SelectorGadget();
            sg.makeInterface();
            sg.setMode('interactive');
            console.log("SelectorGadget loaded and patched!");
          }
        }, 1000);
      })();
    </script>
  `;

  let modified = html;
  if (modified.includes("</body>")) {
    modified = modified.replace("</body>", `${SG_SCRIPT}\n</body>`);
  } else {
    modified += SG_SCRIPT;
  }
  return modified;
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

  app.get("/proxy", async (ctx) => {
    const targetUrl = ctx.req.query("url");
    if (!targetUrl) {
      return ctx.text('Missing "url" parameter', 400);
    }

    const flaresolverrEnabled = ctx.req.query("flaresolverrEnabled") === "true";
    const flaresolverrUrl = normalizeUrl(ctx.req.query("flaresolverrUrl") || "");
    const flaresolverrTimeout = parseInt(
      ctx.req.query("flaresolverrTimeout") || "60000",
      10,
    );

    const proxyPolicyOptions = getGlobalFetchPolicyOptions();
    try {
      await assertOutboundFetchAllowed(targetUrl, proxyPolicyOptions);
    } catch (policyErr: any) {
      return ctx.text(policyErr.message, 403);
    }

    try {
      let html: string;

      if (flaresolverrEnabled && flaresolverrUrl) {
        try {
          await assertOutboundFetchAllowed(
            `${flaresolverrUrl}/v1`,
            proxyPolicyOptions,
          );
        } catch (policyErr: any) {
          return ctx.text(policyErr.message, 403);
        }

        const flaresolverrPayload = {
          cmd: "request.get",
          url: targetUrl,
          maxTimeout: flaresolverrTimeout,
        };

        const flaresolverrResponse = await axios.post(
          `${flaresolverrUrl}/v1`,
          flaresolverrPayload,
          {
            headers: { "Content-Type": "application/json" },
            timeout: flaresolverrTimeout + 5000,
          },
        );

        if (
          flaresolverrResponse.data?.solution?.response &&
          flaresolverrResponse.data?.solution?.status === 200
        ) {
          html = flaresolverrResponse.data.solution.response;
        } else {
          throw new Error(
            `FlareSolverr failed: ${flaresolverrResponse.data?.message || "Unknown error"}`,
          );
        }
      } else {
        const response = await axiosGetWithPolicyRedirects(
          targetUrl,
          {},
          proxyPolicyOptions,
        );
        html = response.data;
      }

      html = injectSelectorGadget(html);
      return ctx.html(html);
    } catch (error) {
      console.error("Error fetching remote URL:", error);
      return ctx.text("Could not fetch the target URL", 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /passkey
  // -------------------------------------------------------------------------

  app.get("/passkey", (c) => {
    return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Enter Passkey</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
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
