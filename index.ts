import { file } from "bun";
import { existsSync, mkdirSync, unlink } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { type Context, Hono } from "hono";
import { serveStatic, getConnInfo } from "hono/bun";
import { except } from "hono/combine";
import * as yaml from "js-yaml";
import minimist from "minimist";
import { basename, join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { DOMParser } from "xmldom";
import CSSTarget from "./models/csstarget.model";
import axios from "axios";
import { createInterface } from "readline";
import { buildRSS, buildRSSFromApiData } from "./utilities/rss-builder.utility";
import type { Config } from "node-imap";
import { listImapFolders } from "./utilities/imap.utility";
import { encrypt } from "./utilities/security.utility";
import { maskProtectedValues, preserveMaskedProtectedValues, protectValue } from "./utilities/protected-values.utility";
import { normalizeLoadedFeedConfig } from "./utilities/feed-config-normalizer.utility";
import { castFeedFormDataToFeedConfig } from "./utilities/feed-config-caster.utility";
import { validateFeedConfig } from "./utilities/feed-config-validator.utility";
import { CookieStore, sessionMiddleware } from "hono-sessions";
import { suggestSelectors } from "./utilities/suggestion-engine.utility";
import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "./utilities/chrome-extensions.utility";
import { getRandomUserAgent } from "./utilities/user-agents.utility";
import * as cheerio from "cheerio";
import { EventEmitter } from "node:events";
import { initDb, getDb, insertRunLog, pruneRunLogs, getSettings, saveSettings, createFeedHistoryStore, migrateLegacyFeedHistory } from "./lib/analytics/db";
import { assertOutboundFetchAllowed, parseAllowlist, type OutboundFetchPolicyOptions } from "./utilities/outbound-fetch-policy.utility";
import { setFeedHistoryStore } from "./utilities/feed-history.utility";
import type { RunLog } from "./lib/analytics/schema";
import { sql, and, eq, gte, lte, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as analyticsSchema from "./lib/analytics/schema";
import { streamSSE } from "hono/streaming";

const app = new Hono();
const runLogEmitter = new EventEmitter();
runLogEmitter.setMaxListeners(100);
const store = new CookieStore();
const args = minimist(process.argv.slice(3));

/**
 * Returns outbound fetch policy options derived from environment variables.
 * Migration note: replace these env reads with settings lookups when the
 * Settings Page is implemented.
 */
function getGlobalFetchPolicyOptions(): OutboundFetchPolicyOptions {
  return {
    allowPrivateFetches: process.env.ALLOW_PRIVATE_FETCHES === "true",
    allowlist: parseAllowlist(process.env.OUTBOUND_FETCH_ALLOWLIST),
  };
}

/**
 * Merges feed-level allowPrivateFetches / allowlist overrides on top of global
 * policy options. Feed values take priority when explicitly present on the config.
 */
function mergeFeedPolicyOptions(
  global: OutboundFetchPolicyOptions,
  feedConfig: any,
): OutboundFetchPolicyOptions {
  const hasFeedOverride = feedConfig != null && 'allowPrivateFetches' in feedConfig;
  const feedAllowlist: string[] = parseAllowlist(
    Array.isArray(feedConfig?.allowlist)
      ? feedConfig.allowlist.join(",")
      : feedConfig?.allowlist
  );
  return {
    allowPrivateFetches: hasFeedOverride
      ? (feedConfig.allowPrivateFetches as boolean)
      : (global.allowPrivateFetches ?? false),
    allowlist: [...new Set([...(global.allowlist ?? []), ...feedAllowlist])],
  };
}

const REDIRECT_STATUSES_IDX = new Set([301, 302, 303, 307, 308]);

/**
 * Performs an axios GET that manually follows redirects, re-checking the
 * outbound fetch policy on each hop. Prevents redirect-based SSRF.
 */
async function axiosGetWithPolicyRedirects(
  url: string,
  config: import("axios").AxiosRequestConfig,
  policyOptions: OutboundFetchPolicyOptions,
  maxRedirects = 5,
): Promise<import("axios").AxiosResponse> {
  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await axios.get(currentUrl, { ...config, maxRedirects: 0 });
    if (!REDIRECT_STATUSES_IDX.has(response.status)) {
      return response;
    }
    const location = response.headers["location"];
    if (!location) {
      throw new Error(`Redirect from "${currentUrl}" had no Location header.`);
    }
    const nextUrl = new URL(location, currentUrl).toString();
    await assertOutboundFetchAllowed(nextUrl, policyOptions);
    currentUrl = nextUrl;
  }
  throw new Error(`Too many redirects (>${maxRedirects}) following "${url}".`);
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Helper function to normalize URLs by removing trailing slashes
function normalizeUrl(url: string): string {
  if (!url) return url;
  return url.replace(/\/+$/, ""); // Remove one or more trailing slashes
}

function makeExtract(body: Record<string, any>) {
  return (key: string, fallback: any = undefined) => body[key] ?? fallback;
}

function makeExtractBool(body: Record<string, any>) {
  return (key: string, fallback: boolean = false): boolean => {
    const val = body[key];
    if (val === undefined) return fallback;
    if (typeof val === "boolean") return val;
    return ["on", "true", "checked"].includes(String(val).toLowerCase());
  };
}

function makeExtractJson(body: Record<string, any>) {
  return (key: string, fallback: any = {}): any => {
    const val = body[key];
    if (typeof val === "object" && val !== null) return val;
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return fallback; }
    }
    return fallback;
  };
}

function makeExtractKeyValuePairs(body: Record<string, any>) {
  return (key: string, fallback: any = {}): Record<string, string> => {
    const val = body[key];
    if (Array.isArray(val)) {
      return val.reduce((acc: Record<string, string>, pair: any) => {
        if (pair?.key) acc[pair.key] = pair.value ?? "";
        return acc;
      }, {});
    }
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return fallback; }
    }
    if (typeof val === "object" && val !== null) return val;
    return fallback;
  };
}

const SSL = process.env.SSL === "true" || args.ssl === true;

async function getSecrets() {
  const passkey =
    process.env.PASSKEY ?? args.passkey ?? (await prompt("Enter passkey: "));
  const cookieSecret =
    process.env.COOKIE_SECRET ??
    args.cookieSecret ??
    (await prompt("Enter cookie secret: "));
  const encryptionKey =
    process.env.ENCRYPTION_KEY ??
    args.encryptionKey ??
    (await prompt("Enter encryption key: "));
  return { passkey, cookieSecret, encryptionKey };
}

const { passkey, cookieSecret, encryptionKey } = await getSecrets();
var feedUpdaters: Map<string, Worker> = new Map();
var feedIntervals: Map<string, Timer> = new Map();

const feedPath = join(__dirname, "/public/feeds");
if (!existsSync(feedPath)) {
  mkdirSync(feedPath);
}

const configsDir = join(__dirname, "configs");
if (!existsSync(configsDir)) {
  mkdirSync(configsDir);
}

// Start processing immediately on startup
try {
  initDb();
} catch (e) {
  console.error("[Analytics] Failed to initialize DB — health tracking disabled:", e);
}

try {
  const runtimeDb = getDb();
  setFeedHistoryStore(createFeedHistoryStore(runtimeDb));
  const migrationResult = await migrateLegacyFeedHistory(runtimeDb);
  console.log(
    `[Startup] Feed history migration complete: ` +
    `${migrationResult.snapshots} snapshots, ` +
    `${migrationResult.dateIndexes} date indexes migrated.`,
  );
} catch (err) {
  console.error(
    "[Startup] Feed history DB init failed — continuing with file-based fallback:",
    err,
  );
}
processFeedsAtStart();
//ALLOW LOCAL NETWORK TO ACCESS API
const middleware = async (c: Context, next) => {
  const connInfo = await getConnInfo(c);
  const isLocal =
    !connInfo?.remote?.address ||
    ["127.0.0.1", "::1"].includes(connInfo.remote.address);

  if (isLocal) return await next();

  const session = c.get("session");
  const authenticated = session.get("authenticated");

  if (authenticated === true) {
    return await next();
  }

  if (c.req.method === "POST" && c.req.path === "/passkey") {
    const body = await c.req.parseBody();
    const inputKey = body.passkey;

    if (inputKey === passkey) {
      session.set("authenticated", true);
      return c.redirect("/");
    } else {
      return c.html(
        '<p>Incorrect passkey. <a href="/passkey">Try again</a>.</p>'
      );
    }
  }

  if (c.req.path === "/passkey") {
    return await next();
  }

  return c.redirect("/passkey");
};

app.use(
  "*",
  sessionMiddleware({
    store,
    encryptionKey: cookieSecret,
    expireAfterSeconds: 60 * 60 * 24,
    cookieOptions: {
      path: "/",
      httpOnly: true,
      secure: SSL,
      sameSite: "lax",
    },
  })
);
app.use("/*", except("/public/feeds/*", middleware));
app.use("/public/*", serveStatic({ root: "./" }));
app.use("/configs/*", serveStatic({ root: "./" }));
app.get("/", (ctx) => ctx.html(file("./public/index.html").text()));
app.post("/", async (ctx) => {
  const feedId = uuidv4();
  const contentType = ctx.req.header("Content-Type") || "";

  let body: Record<string, any>;
  let sampleHtml = "";

  try {
    if (contentType.includes("application/json")) {
      body = await ctx.req.json();
    } else if (
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      const formData = await ctx.req.formData();
      body = Object.fromEntries(formData as any);

      const potentialDrillChainKeys = Object.keys(body).filter((k) =>
        k.includes("DrillChain")
      );
      const structuredDrillChains: Record<string, any[]> = {};

      for (const key of potentialDrillChainKeys) {
        const drillChainMatch = key.match(
          /^(\w+)DrillChain\[(\d+)\]\[(\w+)\]$/
        );
        if (drillChainMatch) {
          const fieldName = drillChainMatch[1];
          const index = parseInt(drillChainMatch[2], 10);
          const property = drillChainMatch[3];
          const chainKey = `${fieldName}DrillChain`;
          const value = body[key];

          if (!structuredDrillChains[chainKey]) {
            structuredDrillChains[chainKey] = [];
          }
          while (structuredDrillChains[chainKey].length <= index) {
            structuredDrillChains[chainKey].push({});
          }
          if (value !== null && value !== undefined) {
            structuredDrillChains[chainKey][index][property] = value;
            delete body[key];
          }
        }
      }
      Object.assign(body, structuredDrillChains);
    } else {
      return ctx.text("Unsupported Content-Type.", 415);
    }

    if (body.feedType === "webScraping" && body.feedUrl) {
      try {
        // SSRF protection: validate feed URL before fetching sample HTML.
        // Merge feed-level allowPrivateFetches/allowlist overrides over global options.
        const sampleHtmlPolicyOptions = mergeFeedPolicyOptions(getGlobalFetchPolicyOptions(), body);
        await assertOutboundFetchAllowed(body.feedUrl, sampleHtmlPolicyOptions);

        // Check if FlareSolverr is enabled for this request
        const flaresolverrData = body.flaresolverr || {};
        const flaresolverrEnabled =
          typeof flaresolverrData.enabled === "boolean"
            ? flaresolverrData.enabled
            : false;
        const flaresolverrUrl = normalizeUrl(flaresolverrData.serverUrl || "");
        const flaresolverrTimeout =
          parseInt(flaresolverrData.timeout || "60000", 10) || 60000;

        if (flaresolverrEnabled && flaresolverrUrl) {
          // Use FlareSolverr to fetch sample HTML
          const flaresolverrPayload: any = {
            cmd: "request.get",
            url: body.feedUrl,
            maxTimeout: flaresolverrTimeout,
          };

          // Add cookies if present
          if (body.cookies && body.cookies.length > 0) {
            flaresolverrPayload.cookies = body.cookies.map((c: any) => ({
              name: c.name,
              value: c.value,
            }));
          }

          const flaresolverrResponse = await axios.post(
            `${flaresolverrUrl}/v1`,
            flaresolverrPayload,
            {
              headers: {
                "Content-Type": "application/json",
              },
              timeout: flaresolverrTimeout + 5000,
            }
          );

          if (
            flaresolverrResponse.data?.solution?.response &&
            flaresolverrResponse.data?.solution?.status === 200
          ) {
            sampleHtml = flaresolverrResponse.data.solution.response;
          } else {
            console.warn(
              "FlareSolverr failed for sample HTML:",
              flaresolverrResponse.data?.message
            );
            sampleHtml = "";
          }
        } else {
          // Use redirect-aware fetch to prevent redirect-based SSRF
          const response = await axiosGetWithPolicyRedirects(body.feedUrl, {
            maxContentLength: 2 * 1024 * 1024,
            maxBodyLength: 2 * 1024 * 1024,
          }, sampleHtmlPolicyOptions);
          sampleHtml = response.data;
        }
      } catch (e) {
        console.warn(
          "Could not fetch sample HTML for URL analysis:",
          e.message
        );
        sampleHtml = "";
      }
    }
  } catch (e) {
    console.error("Error parsing request body:", e);
    return ctx.text("Invalid request body.", 400);
  }

  let finalFeedConfig: any;
  try {
    finalFeedConfig = castFeedFormDataToFeedConfig(body as any, {
      feedId,
      encryptionKey,
    });
  } catch (castErr: any) {
    if (contentType.includes("application/json")) {
      return ctx.json({ errors: [{ path: "feedType", message: castErr.message }] }, 400);
    }
    return ctx.text(castErr.message, 400);
  }

  const validation = validateFeedConfig(finalFeedConfig);
  if (!validation.valid) {
    if (contentType.includes("application/json")) {
      return ctx.json({ errors: validation.errors, warnings: validation.warnings }, 400);
    }
    return ctx.text(validation.errors.map((e: any) => e.message).join("\n"), 400);
  }

  const yamlStr = yaml.dump(finalFeedConfig);
  const yamlFilePath = join(configsDir, `${feedId}.yaml`);
  await writeFile(yamlFilePath, yamlStr, "utf8");

  setFeedUpdaterInterval(finalFeedConfig);

  if (contentType.includes("application/json")) {
    return ctx.json({
      message: "RSS feed is being generated.",
      feedUrl: `public/feeds/${feedId}.xml`,
      feedId: feedId,
      config: maskProtectedValues(finalFeedConfig),
    });
  }

  return ctx.html(`
    <p>Your RSS feed is being generated and will update every ${finalFeedConfig.refreshTime} minutes.</p>
    <p>Access it at: <a href="/public/feeds/${feedId}.xml">/public/feeds/${feedId}.xml</a></p>
    <p><a href="/feeds">View all feeds</a></p>
  `);
});

app.post("/preview", async (ctx) => {
  try {
    const jsonData = await ctx.req.json();

    let previewConfig: any;
    try {
      previewConfig = castFeedFormDataToFeedConfig(jsonData as Record<string, unknown>, {
        feedId: "preview",
        encryptionKey,
      });
    } catch (castErr: any) {
      return ctx.json({ errors: [{ path: "feedType", message: castErr.message }] }, 400);
    }

    const previewValidation = validateFeedConfig(previewConfig);
    if (!previewValidation.valid) {
      return ctx.json({ errors: previewValidation.errors, warnings: previewValidation.warnings }, 400);
    }

    // Carry _debug_advanced_raw for logging in generatePreview
    previewConfig._debug_advanced_raw = jsonData.advanced;

    const response = await generatePreview(previewConfig);

    return ctx.text(response, 200, {
      "Content-Type": "application/rss+xml",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
  } catch (error) {
    console.error("Error generating preview:", error);
    // Check if error is an Axios error or similar with a response object
    if (error.response?.data) {
      console.error("Error response data:", error.response.data);
      return ctx.text(
        `Error generating preview: ${
          error.message
        }. Server responded with: ${JSON.stringify(error.response.data)}`,
        400
      );
    } else if (error.request) {
      console.error("Error request data:", error.request);
      return ctx.text(
        `Error generating preview: ${error.message}. No response received from server.`,
        400
      );
    }
    return ctx.text(`Error generating preview: ${error.message}`, 400);
  }
});


function injectSelectorGadget(html) {
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

app.get("/proxy", async (ctx) => {
  // 1) Read the remote URL from query params
  const targetUrl = ctx.req.query("url");
  if (!targetUrl) {
    return ctx.text('Missing "url" parameter', 400);
  }

  const flaresolverrEnabled = ctx.req.query("flaresolverrEnabled") === "true";
  const flaresolverrUrl = normalizeUrl(ctx.req.query("flaresolverrUrl") || "");
  const flaresolverrTimeout = parseInt(
    ctx.req.query("flaresolverrTimeout") || "60000", 10
  );

  // SSRF protection: validate target URL before fetching
  const proxyPolicyOptions = getGlobalFetchPolicyOptions();
  try {
    await assertOutboundFetchAllowed(targetUrl, proxyPolicyOptions);
  } catch (policyErr: any) {
    return ctx.text(policyErr.message, 403);
  }

  try {
    let html: string;

    if (flaresolverrEnabled && flaresolverrUrl) {
      // Use FlareSolverr to fetch the page
      const flaresolverrPayload = {
        cmd: "request.get",
        url: targetUrl,
        maxTimeout: flaresolverrTimeout,
      };

      const flaresolverrResponse = await axios.post(
        `${flaresolverrUrl}/v1`,
        flaresolverrPayload,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: flaresolverrTimeout + 5000,
        }
      );

      if (
        flaresolverrResponse.data?.solution?.response &&
        flaresolverrResponse.data?.solution?.status === 200
      ) {
        html = flaresolverrResponse.data.solution.response;
      } else {
        throw new Error(
          `FlareSolverr failed: ${
            flaresolverrResponse.data?.message || "Unknown error"
          }`
        );
      }
    } else {
      // Redirect-aware fetch to prevent redirect-based SSRF
      const response = await axiosGetWithPolicyRedirects(targetUrl, {}, proxyPolicyOptions);
      html = response.data;
    }

    html = injectSelectorGadget(html);

    return ctx.html(html);
  } catch (error) {
    console.error("Error fetching remote URL:", error);
    return ctx.text("Could not fetch the target URL", 500);
  }
});

// Passkey entry routes
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

app.post("/delete-feed", async (c) => {
  const data = await c.req.parseBody();
  const feedId = data.feedId;

  if (!feedId) {
    return c.text("Feed name is required.", 400);
  }

  const sanitizedFeedName = basename(feedId as string); // Prevent path traversal
  const success = await deleteFeed(sanitizedFeedName);

  if (success) {
    return c.redirect("/feeds");
  } else {
    return c.text("Failed to delete feed.", 500);
  }
});

app.post("/trigger-webhook", async (c) => {
  const { feedId } = await c.req.json();

  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }

  try {
    const sanitizedFeedId = basename(feedId as string);
    const configPath = join(configsDir, `${sanitizedFeedId}.yaml`);

    // Check if feed exists
    if (!existsSync(configPath)) {
      return c.json({ error: "Feed not found" }, 404);
    }

    // Load feed configuration
    const yamlContent = await readFile(configPath, "utf8");
    const feedConfig = yaml.load(yamlContent) as any;

    if (!feedConfig.webhook?.enabled || !feedConfig.webhook?.url) {
      return c.json({ error: "Webhook not configured for this feed" }, 400);
    }

    // Read current RSS feed
    const rssPath = join(feedPath, `${sanitizedFeedId}.xml`);
    if (!existsSync(rssPath)) {
      return c.json({ error: "RSS feed not generated yet" }, 404);
    }

    const rssXml = await readFile(rssPath, "utf8");

    // Import webhook utilities
    const { sendWebhook, createWebhookPayload, createJsonWebhookPayload } =
      await import("./utilities/webhook.utility");

    // Create webhook payload
    const payload =
      feedConfig.webhook.format === "json"
        ? createJsonWebhookPayload(feedConfig, rssXml, "manual")
        : createWebhookPayload(feedConfig, rssXml, "manual");

    // Send webhook
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

app.post("/imap/folders", async (c) => {
  const config = await c.req.json<Config>();
  console.log("IMAP config:", {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password ? "[REDACTED]" : undefined,
  });
  const folders = await listImapFolders(config);
  console.log("IMAP folders:", folders);
  return c.json({ folders });
});

app.post("/utils/suggest-selectors", async (c) => {
  const { url, flaresolverr, cookies } = await c.req.json();
  // SSRF protection: validate URL before fetching for selector suggestions
  const suggestPolicyOptions = getGlobalFetchPolicyOptions();
  try {
    await assertOutboundFetchAllowed(url, suggestPolicyOptions);
  } catch (policyErr: any) {
    return c.json({ error: policyErr.message }, 403);
  }
  try {
    // Pass policy options so the utility can re-check on any redirect
    const selectors = await suggestSelectors(url, flaresolverr, cookies, suggestPolicyOptions);
    return c.json(selectors);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/flaresolverr/health", async (c) => {
  const { serverUrl } = await c.req.json();

  if (!serverUrl) {
    return c.json({ active: false, error: "No server URL provided" });
  }

  // Normalize URL to remove trailing slashes
  const normalizedUrl = normalizeUrl(serverUrl);

  // SSRF protection: validate the server URL before fetching
  try {
    await assertOutboundFetchAllowed(`${normalizedUrl}/`, getGlobalFetchPolicyOptions());
  } catch (policyErr: any) {
    return c.json({ active: false, error: policyErr.message });
  }

  try {
    // Try to reach the FlareSolverr server
    const response = await axios.get(`${normalizedUrl}/`, {
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: () => true, // Accept any status code
    });

    // If we get any response, the server is reachable
    return c.json({ active: true, status: response.status });
  } catch (error) {
    return c.json({ active: false, error: error.message });
  }
});

app.post("/utils/root-url", async (c) => {
  const { url } = await c.req.json();
  try {
    const parsed = new URL(url);
    return c.json({ origin: parsed.origin });
  } catch {
    return c.json({ origin: "" }, 400);
  }
});

app.get("/api/feeds", async (ctx) => {
  const files = await readdir(configsDir);
  const yamlFiles = files.filter((f) => f.endsWith(".yaml"));
  const feeds = [];

  for (const file of yamlFiles) {
    const filePath = join(configsDir, file);
    const yamlContent = await readFile(filePath, "utf8");
    const config = yaml.load(yamlContent) as any;

    let lastBuildDate = "Not yet built";
    try {
      const xmlFilePath = join(feedPath, `${config.feedId}.xml`);
      const xmlContent = await readFile(xmlFilePath, "utf8");
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
      const node = xmlDoc.getElementsByTagName("lastBuildDate")[0];
      if (node?.textContent) {
        lastBuildDate = new Date(node.textContent).toLocaleString();
      }
    } catch {
      // XML not yet generated — leave as "Not yet built"
    }

    feeds.push({
      feedId: config.feedId,
      feedName: config.feedName,
      feedType: config.feedType,
      lastBuildDate,
      webhookEnabled: !!(config.webhook?.enabled && config.webhook?.url),
    });
  }

  return ctx.json(feeds);
});

app.get("/api/feeds/:id/config", async (ctx) => {
  const feedId = basename(ctx.req.param("id"));
  const configPath = join(configsDir, `${feedId}.yaml`);

  if (!existsSync(configPath)) {
    return ctx.json({ error: "Feed not found" }, 404);
  }

  const yamlContent = await readFile(configPath, "utf8");
  const raw = yaml.load(yamlContent) as Record<string, unknown>;
  const config = normalizeLoadedFeedConfig(raw);
  return ctx.json(maskProtectedValues(config));
});

app.put("/api/feeds/:id", async (ctx) => {
  const feedId = basename(ctx.req.param("id"));
  const configPath = join(configsDir, `${feedId}.yaml`);

  if (!existsSync(configPath)) {
    return ctx.json({ error: "Feed not found" }, 404);
  }

  const existingYaml = await readFile(configPath, "utf8");
  const existingConfigRaw = yaml.load(existingYaml) as Record<string, unknown>;
  const existingConfig = normalizeLoadedFeedConfig(existingConfigRaw);

  const contentType = ctx.req.header("Content-Type") || "";
  let body: Record<string, any>;
  let sampleHtml = "";

  try {
    if (contentType.includes("application/json")) {
      body = await ctx.req.json();
    } else {
      return ctx.text("Unsupported Content-Type.", 415);
    }

    if (body.feedType === "webScraping" && body.feedUrl) {
      try {
        // SSRF protection: validate feed URL before fetching sample HTML.
        // Merge feed-level allowPrivateFetches/allowlist overrides over global options.
        const putSamplePolicyOptions = mergeFeedPolicyOptions(getGlobalFetchPolicyOptions(), body);
        await assertOutboundFetchAllowed(body.feedUrl, putSamplePolicyOptions);

        const flaresolverrData = body.flaresolverr || {};
        const flaresolverrEnabled = typeof flaresolverrData.enabled === "boolean" ? flaresolverrData.enabled : false;
        const flaresolverrUrl = normalizeUrl(flaresolverrData.serverUrl || "");
        const flaresolverrTimeout = parseInt(flaresolverrData.timeout || "60000", 10) || 60000;

        if (flaresolverrEnabled && flaresolverrUrl) {
          const payload: any = { cmd: "request.get", url: body.feedUrl, maxTimeout: flaresolverrTimeout };
          if (body.cookies?.length > 0) payload.cookies = body.cookies.map((c: any) => ({ name: c.name, value: c.value }));
          const resp = await axios.post(`${flaresolverrUrl}/v1`, payload, { headers: { "Content-Type": "application/json" }, timeout: flaresolverrTimeout + 5000 });
          if (resp.data?.solution?.response && resp.data?.solution?.status === 200) sampleHtml = resp.data.solution.response;
        } else {
          // Use redirect-aware fetch to prevent redirect-based SSRF
          const resp = await axiosGetWithPolicyRedirects(body.feedUrl, { maxContentLength: 2 * 1024 * 1024, maxBodyLength: 2 * 1024 * 1024 }, putSamplePolicyOptions);
          sampleHtml = resp.data;
        }
      } catch (e) {
        console.warn("Could not fetch sample HTML for URL analysis:", e.message);
      }
    }
  } catch (e) {
    console.error("Error parsing request body:", e);
    return ctx.text("Invalid request body.", 400);
  }

  // 1. Cast — encrypts new protected values, leaves "********" alone
  let castConfig: any;
  try {
    castConfig = castFeedFormDataToFeedConfig(body as any, {
      feedId,
      encryptionKey,
    });
  } catch (castErr: any) {
    return ctx.json({ errors: [{ path: "feedType", message: castErr.message }] }, 400);
  }

  // 2. Preserve — restores "********" sentinels to original ciphertext
  const finalFeedConfig = preserveMaskedProtectedValues(castConfig, existingConfig);

  // 2a. Restore email password if the caster produced undefined (edit mode with no password change)
  if (
    finalFeedConfig.feedType === "email" &&
    !(finalFeedConfig as any).config?.password &&
    !(finalFeedConfig as any).config?.encryptedPassword
  ) {
    const existingPassword = (existingConfig as any).config?.password ?? (
      (existingConfig as any).config?.encryptedPassword?.trim?.()?.length > 0
        ? { type: "protected" as const, value: (existingConfig as any).config.encryptedPassword }
        : undefined
    );
    if (existingPassword) {
      (finalFeedConfig as any).config = {
        ...(finalFeedConfig as any).config,
        password: existingPassword,
      };
    }
  }

  // 3. Validate
  const validation = validateFeedConfig(finalFeedConfig as any);
  if (!validation.valid) {
    return ctx.json({ errors: validation.errors, warnings: validation.warnings }, 400);
  }

  const yamlStr = yaml.dump(finalFeedConfig);
  await writeFile(configPath, yamlStr, "utf8");

  // Restart worker with updated config
  clearFeedUpdaterInterval(feedId);
  const oldWorker = feedUpdaters.get(feedId);
  if (oldWorker) {
    oldWorker.terminate();
    feedUpdaters.delete(feedId);
  }
  setFeedUpdaterInterval(finalFeedConfig);

  return ctx.json({
    message: "Feed updated successfully.",
    feedUrl: `public/feeds/${feedId}.xml`,
    feedId,
    config: maskProtectedValues(finalFeedConfig),
  });
});

app.get("/api/health/runs", async (c) => {
  const { feedId, status, feedType, from, to, page = "1", pageSize = "50" } = c.req.query();
  const db = drizzle(getDb(), { schema: analyticsSchema });

  const conditions: any[] = [];
  if (feedId) conditions.push(eq(analyticsSchema.runLogs.feedId, feedId));
  if (status) conditions.push(eq(analyticsSchema.runLogs.status, status));
  if (feedType) conditions.push(eq(analyticsSchema.runLogs.feedType, feedType));
  if (from) conditions.push(gte(analyticsSchema.runLogs.startedAt, Number(from)));
  if (to) conditions.push(lte(analyticsSchema.runLogs.startedAt, Number(to)));

  const where = conditions.length ? and(...conditions) : undefined;
  const offset = (Number(page) - 1) * Number(pageSize);

  const [rows, countResult] = await Promise.all([
    db.select().from(analyticsSchema.runLogs).where(where).orderBy(desc(analyticsSchema.runLogs.startedAt)).limit(Number(pageSize)).offset(offset),
    db.select({ count: sql`count(*)` }).from(analyticsSchema.runLogs).where(where),
  ]);

  return c.json({ rows, total: Number(countResult[0].count) });
});

app.get("/api/health/summary", async (c) => {
  const db = drizzle(getDb(), { schema: analyticsSchema });
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;
  const last7d = now - 7 * 24 * 60 * 60 * 1000;

  const [totalResult, last24hResult, last7dRows, allFeeds] = await Promise.all([
    db.select({ count: sql`count(*)` }).from(analyticsSchema.runLogs),
    db.select({ count: sql`count(*)` }).from(analyticsSchema.runLogs).where(gte(analyticsSchema.runLogs.startedAt, last24h)),
    db.select().from(analyticsSchema.runLogs).where(gte(analyticsSchema.runLogs.startedAt, last7d)),
    db.selectDistinct({ feedId: analyticsSchema.runLogs.feedId, feedName: analyticsSchema.runLogs.feedName, feedType: analyticsSchema.runLogs.feedType }).from(analyticsSchema.runLogs),
  ]);

  const successCount = last7dRows.filter((r) => r.status === "success").length;
  const successRate7d = last7dRows.length ? successCount / last7dRows.length : 0;
  const durations = last7dRows.filter((r) => r.durationMs !== null).map((r) => r.durationMs!);
  const avgDuration7d = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const feedHealth = await Promise.all(
    allFeeds.map(async ({ feedId, feedName, feedType }) => {
      const recent = await db
        .select()
        .from(analyticsSchema.runLogs)
        .where(eq(analyticsSchema.runLogs.feedId, feedId))
        .orderBy(desc(analyticsSchema.runLogs.startedAt))
        .limit(5);
      const last = recent[0];
      const successIn5 = recent.filter((r) => r.status === "success").length;
      const healthStatus = recent.length === 0 ? "green"
        : last.status === "error" ? "red"
        : successIn5 < recent.length ? "yellow"
        : "green";
      const feedLast7d = last7dRows.filter((r) => r.feedId === feedId);
      const feedSuccessCount = feedLast7d.filter((r) => r.status === "success").length;
      const feedDurations = feedLast7d.filter((r) => r.durationMs !== null).map((r) => r.durationMs!);
      return {
        feedId,
        feedName,
        feedType,
        healthStatus,
        lastRunAt: last?.startedAt ?? null,
        lastHttpStatus: last?.httpStatus ?? null,
        successRate7d: feedLast7d.length ? feedSuccessCount / feedLast7d.length : 0,
        avgDuration7d: feedDurations.length ? feedDurations.reduce((a, b) => a + b, 0) / feedDurations.length : 0,
      };
    })
  );

  return c.json({
    totalRuns: Number(totalResult[0].count),
    last24h: Number(last24hResult[0].count),
    successRate7d,
    avgDuration7d,
    feedHealth,
  });
});

app.get("/api/health/chart/:feedId", async (c) => {
  const feedId = c.req.param("feedId");
  const db = drizzle(getDb(), { schema: analyticsSchema });

  const rows = await db
    .select({
      startedAt: analyticsSchema.runLogs.startedAt,
      durationMs: analyticsSchema.runLogs.durationMs,
      itemCount: analyticsSchema.runLogs.itemCount,
      status: analyticsSchema.runLogs.status,
    })
    .from(analyticsSchema.runLogs)
    .where(eq(analyticsSchema.runLogs.feedId, feedId))
    .orderBy(desc(analyticsSchema.runLogs.startedAt))
    .limit(50);

  return c.json({ runs: rows.reverse() });
});

app.get("/api/health/settings", async (c) => {
  const s = await getSettings(getDb());
  return c.json({ ...s, dbPath: process.env.RUNTIME_DB_PATH ?? "./data/runtime.db" });
});

app.put("/api/health/settings", async (c) => {
  const body = await c.req.json();
  await saveSettings(getDb(), {
    retentionDays: Number(body.retentionDays),
    retentionDaysEnabled: Boolean(body.retentionDaysEnabled),
    retentionRuns: Number(body.retentionRuns),
    retentionRunsEnabled: Boolean(body.retentionRunsEnabled),
  });
  return c.json({ ok: true });
});

app.get("/api/health/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const onRun = (row: RunLog) => {
      stream.writeSSE({ data: JSON.stringify(row), event: "run" });
    };
    runLogEmitter.on("run", onRun);

    const ping = setInterval(() => {
      stream.writeSSE({ data: "", event: "ping" });
    }, 25000);

    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });

    clearInterval(ping);
    runLogEmitter.off("run", onRun);
  });
});

app.get("/feeds", (ctx) => ctx.html(file("./public/index.html").text()));
app.get("/feeds/:id/edit", (ctx) => ctx.html(file("./public/index.html").text()));

function isLikelyAbsoluteUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("//");
}

async function determineIsRelativeAndBaseUrl(
  url: string,
  userIsRelative: boolean | undefined,
  userBaseUrl: string | undefined,
  feedUrl: string | undefined
): Promise<{ isRelative: boolean; baseUrl: string | undefined }> {
  // If user explicitly set both isRelative and baseUrl, use those
  if (typeof userIsRelative === "boolean" && userBaseUrl) {
    return { isRelative: userIsRelative, baseUrl: userBaseUrl };
  }

  // If user explicitly set isRelative
  if (typeof userIsRelative === "boolean") {
    if (userIsRelative && !userBaseUrl && feedUrl) {
      return { isRelative: true, baseUrl: feedUrl };
    }
    return { isRelative: userIsRelative, baseUrl: userBaseUrl };
  }

  // If user provided baseUrl but not isRelative, detect from URL format
  if (userBaseUrl) {
    const isAbs = isLikelyAbsoluteUrl(url);
    return { isRelative: !isAbs, baseUrl: userBaseUrl };
  }

  // Auto-detect based on URL format
  const isAbsolute = isLikelyAbsoluteUrl(url);

  if (isAbsolute) {
    return { isRelative: false, baseUrl: undefined };
  } else {
    // Relative URL - use feedUrl as base if available
    return { isRelative: true, baseUrl: feedUrl };
  }
}

function extractSampleUrlFromHtml(
  html: string,
  selector: string,
  attribute?: string
): string {
  const $ = cheerio.load(html);
  const elements = $(selector).slice(0, 5); // Check first 5 elements

  if (elements.length === 0) return "";

  // Try to find a non-empty URL from the sample
  for (let i = 0; i < elements.length; i++) {
    const el = elements.eq(i);
    let url = "";
    if (attribute) {
      url = el.attr(attribute) || "";
    } else {
      url = el.attr("href") || el.attr("src") || "";
    }

    // Return first non-empty URL found
    if (url?.trim()) {
      return url.trim();
    }
  }

  return "";
}

async function buildCSSTarget(
  prefix: string,
  body: Record<string, any>,
  sampleHtml?: string
): Promise<CSSTarget> {
  const extractField = (suffix: string, fallback: any = "") =>
    body[`${prefix}${suffix}`] ?? fallback;
  const extractBoolField = (suffix: string, fallback: boolean = false) => {
    const val = body[`${prefix}${suffix}`];
    if (val === undefined) return fallback;
    if (typeof val === "boolean") return val;
    return ["on", "true", "checked"].includes(String(val).toLowerCase());
  };

  const selector = extractField("Selector");
  const attribute = extractField("Attribute");
  const userIsRelative = extractBoolField("RelativeLink", undefined);
  const userBaseUrl = extractField("BaseUrl", undefined);

  let isRelative = userIsRelative;
  let baseUrl = userBaseUrl;

  // Only apply to link, enclosure, sourceUrl
  if (
    ["link", "enclosure", "sourceUrl"].includes(prefix) &&
    sampleHtml &&
    selector
  ) {
    const urlSample = extractSampleUrlFromHtml(sampleHtml, selector, attribute);
    const result = await determineIsRelativeAndBaseUrl(
      urlSample,
      userIsRelative,
      userBaseUrl,
      body.feedUrl
    );
    isRelative = result.isRelative;
    baseUrl = result.baseUrl;
    console.log(
      `[Preview ${prefix}] Sample URL: "${urlSample}" → isRelative: ${isRelative}, baseUrl: ${baseUrl}`
    );
  }

  // Extract drill chain data directly if it was pre-processed into an array of objects
  const drillChainData = (body[`${prefix}DrillChain`] as Array<any>) || [];
  const target = new CSSTarget(
    selector,
    attribute,
    extractBoolField("StripHtml"),
    baseUrl,
    isRelative,
    extractBoolField("TitleCase"),
    extractField("Iterator"),
    extractField("Format"),
    extractField("CustomDateFormat")
  );
  if (prefix === "guid") {
    target.guidIsPermaLink = extractBoolField("IsPermaLink");
  }
  if (drillChainData.length > 0) {
    target.drillChain = drillChainData.map((step) => ({
      selector: step.selector ?? "",
      attribute: step.attribute ?? "",
      isRelative: ["on", "true", true, "checked"].includes(
        String(step.isRelative).toLowerCase()
      ),
      baseUrl: step.baseUrl ?? "",
      stripHtml: ["on", "true", true, "checked"].includes(
        String(step.stripHtml).toLowerCase()
      ),
    }));
  } else {
    target.drillChain = parseDrillChain(prefix, body);
  }
  return target;
}

function parseDrillChain(
  prefix: string,
  body: Record<string, any>
): Array<{
  selector: string;
  attribute: string;
  isRelative: boolean;
  baseUrl: string;
  stripHtml: boolean;
}> {
  const chainKey = `${prefix}DrillChain`;
  const rawChain = body[chainKey]; // Expects an array of objects from the improved POST / handler

  if (Array.isArray(rawChain)) {
    return rawChain.map((step: any) => ({
      selector: step.selector ?? "",
      attribute: step.attribute ?? "",
      isRelative: ["on", "true", true, "checked"].includes(
        String(step.isRelative).toLowerCase()
      ),
      baseUrl: step.baseUrl ?? "",
      stripHtml: ["on", "true", true, "checked"].includes(
        String(step.stripHtml).toLowerCase()
      ),
    }));
  }

  // This fallback logic for flat keys (e.g., titleDrillChain[0][selector])
  // should ideally not be needed if the main POST / handler correctly structures drill chains.
  // Keeping it as a safety measure or for cases where pre-structuring might fail.
  const chainSteps = [];
  const flatKeyRegex = new RegExp(
    `^${prefix
      .replace(/([A-Z])/g, " $1")
      .split(" ")
      .map((s) => s.toLowerCase())
      .join(
        ""
      )}DrillChain\\[(\\d+)\\]\\[(selector|attribute|isRelative|baseUrl|stripHtml)\\]$`,
    "i"
  );
  const tempStore: Record<string, Record<string, string>> = {};

  for (const key of Object.keys(body)) {
    const match = flatKeyRegex.exec(key);
    if (match) {
      const index = match[1]; // Index from regex
      const fieldName = match[2]; // Property name from regex
      if (!tempStore[index]) tempStore[index] = {};
      tempStore[index][fieldName.toLowerCase()] = String(body[key]);
    }
  }

  const sortedKeys = Object.keys(tempStore).sort(
    (a, b) => parseInt(a, 10) - parseInt(b, 10)
  );
  for (const idx of sortedKeys) {
    const row = tempStore[idx];
    chainSteps.push({
      selector: row.selector ?? "",
      attribute: row.attribute ?? "",
      isRelative: ["on", "true", true, "checked"].includes(
        String(row.isrelative).toLowerCase()
      ), // ensure lowercase for matching
      baseUrl: row.baseUrl ?? "",
      stripHtml: ["on", "true", true, "checked"].includes(
        String(row.striphtml).toLowerCase()
      ), // ensure lowercase
    });
  }
  return chainSteps;
}

function initializeWorker(feedConfig: any) {
  feedUpdaters.set(
    feedConfig.feedId,
    new Worker(
      feedConfig.feedType === "email"
        ? "./workers/imap-feed.worker.ts"
        : "./workers/feed-updater.worker.ts",
      { type: "module" }
    )
  );

  feedUpdaters.get(feedConfig.feedId).onmessage = async (message) => {
    if (message.data.status === "done" || message.data.status === "error") {
      console.log(
        message.data.status === "done"
          ? `Feed updates completed for ${feedConfig.feedId}.`
          : `Feed updates for ${feedConfig.feedId} encountered an error: ${message.data.metrics?.errorMessage}`
      );
      try {
        const metrics = message.data.metrics ?? {};
        const row = await insertRunLog(getDb(), {
          feedId: feedConfig.feedId,
          feedName: feedConfig.feedName ?? feedConfig.config?.title ?? feedConfig.feedId,
          feedType: feedConfig.feedType,
          startedAt: metrics.startedAt ?? Date.now(),
          durationMs: metrics.durationMs ?? null,
          status: message.data.status === "done" ? "success" : "error",
          errorMessage: metrics.errorMessage ?? null,
          httpStatus: metrics.httpStatus ?? null,
          timedOut: metrics.timedOut ?? false,
          itemCount: metrics.itemCount ?? null,
          selectorMatches: metrics.selectorMatches ?? null,
          dateFallbacks: metrics.dateFallbacks ?? 0,
          duplicateGuids: metrics.duplicateGuids ?? 0,
          webhookStatus: metrics.webhookStatus ?? null,
          webhookError: metrics.webhookError ?? null,
        });
        runLogEmitter.emit("run", row);
        await pruneRunLogs(getDb(), feedConfig.feedId, await getSettings(getDb()));
      } catch (e) {
        console.error("[Analytics] Failed to log run:", e);
      }
    }
  };

  feedUpdaters.get(feedConfig.feedId).onerror = async (error) => {
    console.error("Worker error:", error);
    try {
      const row = await insertRunLog(getDb(), {
        feedId: feedConfig.feedId,
        feedName: feedConfig.feedName ?? feedConfig.config?.title ?? feedConfig.feedId,
        feedType: feedConfig.feedType,
        startedAt: Date.now(),
        durationMs: null,
        status: "error",
        errorMessage: error.message ?? "Worker crashed unexpectedly",
        httpStatus: null,
        timedOut: false,
        itemCount: null,
        selectorMatches: null,
        dateFallbacks: 0,
        duplicateGuids: 0,
        webhookStatus: null,
        webhookError: null,
      });
      runLogEmitter.emit("run", row);
    } catch (e) {
      console.error("[Analytics] Failed to log worker crash:", e);
    }
  };
}

async function processFeedsAtStart() {
  try {
    const files = await readdir(configsDir);
    const yamlFiles = files.filter((file) => file.endsWith(".yaml"));

    for (const file of yamlFiles) {
      const filePath = join(configsDir, file);
      const yamlContent = await readFile(filePath, "utf8");
      const feedConfig = yaml.load(yamlContent);
      console.log("Processing feed:", feedConfig.feedId);
      setFeedUpdaterInterval(feedConfig);
    }
  } catch (error) {
    console.error("Error processing feeds:", error);
  }
}

async function generatePreview(feedConfig: any) {
  try {
    let rssXml;
    // The feedConfig passed here should now be the fully expanded one
    // including all item and feed level options as defined in POST / and /preview routes.

    // SSRF protection: validate the target URL before any fetch in preview generation.
    // Merge feed-level allowPrivateFetches/allowlist overrides over global options.
    const previewPolicyOptions = mergeFeedPolicyOptions(getGlobalFetchPolicyOptions(), feedConfig);
    const previewUrl =
      feedConfig.feedType === "webScraping" || feedConfig.feedType === "api" || feedConfig.feedType === "rest"
        ? ((feedConfig.config?.baseUrl || "") + (feedConfig.config?.route || "")).trim()
        : null;
    if (previewUrl) {
      await assertOutboundFetchAllowed(previewUrl, previewPolicyOptions);
    }

    if (feedConfig.feedType === "webScraping") {
      // feedConfig.config contains baseUrl, advanced settings
      // feedConfig.article contains all CSSTargets for items
      // feedConfig directly contains feed-level options like feedLanguage, feedCopyright, etc.
      // or selectors for these if they are to be scraped (though preview might use direct values).

      console.log(
        `[Preview] Advanced mode check: ${feedConfig.advanced} (raw: ${feedConfig._debug_advanced_raw})`
      );
      if (feedConfig.flaresolverr?.enabled) {
        // FlareSolverr scraping
        console.log("[Preview] Using FlareSolverr");
        const flaresolverrUrl = normalizeUrl(
          feedConfig.flaresolverr.serverUrl || "http://localhost:8191"
        );
        const timeout = feedConfig.flaresolverr.timeout || 60000;

        const flaresolverrPayload: any = {
          cmd: "request.get",
          url: feedConfig.config.baseUrl,
          maxTimeout: timeout,
        };

        // Add cookies if present
        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          flaresolverrPayload.cookies = feedConfig.cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
          }));
        }

        const flaresolverrResponse = await axios.post(
          `${flaresolverrUrl}/v1`,
          flaresolverrPayload,
          {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: timeout + 5000,
          }
        );

        if (
          flaresolverrResponse.data?.solution?.response &&
          flaresolverrResponse.data?.solution?.status === 200
        ) {
          const html = flaresolverrResponse.data.solution.response;
          rssXml = (await buildRSS(html, feedConfig)).xml;
        } else {
          throw new Error(
            `FlareSolverr failed: ${
              flaresolverrResponse.data?.message || "Unknown error"
            }`
          );
        }
      } else if (feedConfig.advanced) {
        // Check for advanced scraping (e.g., Playwright)
        console.log("[Preview] Launching browser...");
        const browser = await chromium.launch(
          getChromiumLaunchOptions({
            headless: true,
            timeout: 60000, // 1 minute timeout (bundled chromium is faster)
          })
        );
        console.log("[Preview] Browser launched, creating context...");
        const userAgent = getRandomUserAgent();
        const context = await browser.newContext({ userAgent });
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
        });
        const page = await context.newPage();
        console.log(
          `[Preview] Using user agent: ${userAgent.substring(0, 50)}...`
        );

        if (feedConfig.headers && Object.keys(feedConfig.headers).length) {
          await page.setExtraHTTPHeaders(feedConfig.headers);
        }

        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          const domain = new URL(feedConfig.config.baseUrl).hostname;
          const playwrightCookies = feedConfig.cookies.map((c) => ({
            ...c,
            domain,
            path: "/",
          }));
          if (playwrightCookies.length)
            await page.context().addCookies(playwrightCookies);
        }

        console.log(`[Preview] Navigating to ${feedConfig.config.baseUrl}...`);
        try {
          // Try networkidle first with a short timeout for better content capture
          await page.goto(feedConfig.config.baseUrl, {
            waitUntil: "networkidle",
            timeout: 10000, // 10 second timeout for networkidle
          });
          console.log("[Preview] Page loaded (networkidle)");
        } catch (_error) {
          // If networkidle times out, page is likely already loaded
          console.log(
            "[Preview] Networkidle timeout, using current page state"
          );
        }
        console.log("[Preview] Extracting content...");
        const html = await page.content();
        await browser.close();
        console.log("[Preview] Browser closed, building RSS...");
        // buildRSS expects the full feedConfig which now includes all detailed options
        rssXml = (await buildRSS(html, feedConfig)).xml;
      } else {
        // Standard axios call for non-advanced web scraping (redirect-aware to prevent SSRF)
        console.log("[Preview] Using standard (non-advanced) scraping");
        const cookieString = (feedConfig.cookies || [])
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        const response = await axiosGetWithPolicyRedirects(feedConfig.config.baseUrl, {
          headers: {
            ...(feedConfig.headers || {}),
            ...(cookieString && { Cookie: cookieString }),
          },
          maxContentLength: 2 * 1024 * 1024,
          maxBodyLength: 2 * 1024 * 1024,
          timeout: 30000, // 30 second timeout
        }, previewPolicyOptions);
        console.log("[Preview] Page fetched, building RSS...");
        const html = response.data;
        rssXml = (await buildRSS(html, feedConfig)).xml;
        console.log("[Preview] RSS build complete");
      }
    } else if (feedConfig.feedType === "api" || feedConfig.feedType === "rest") {
      const method = String(feedConfig.config.method || "GET").toUpperCase();
      const url = (feedConfig.config.baseUrl || "").trim() + (feedConfig.config.route || "").trim();

      const headers = {
        Accept: "application/json",
        ...(feedConfig.headers || {}),
        ...(feedConfig.config.apiSpecificHeaders || {}),
      };

      const axiosConfig: any = {
        method,
        url,
        headers,
        params: feedConfig.config.params || {},
        responseType: "json",
        validateStatus: (s: number) => s >= 200 && s < 400,
      };

      const cookieString = (feedConfig.cookies || [])
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

      if (
        cookieString &&
        !axiosConfig.headers.Authorization &&
        !axiosConfig.headers.cookie
      ) {
        axiosConfig.headers.Cookie = cookieString;
      }

      const body = feedConfig.config.apiSpecificBody || {};
      const hasBody =
        method !== "GET" &&
        method !== "HEAD" &&
        body &&
        typeof body === "object" &&
        Object.keys(body).length > 0;

      if (hasBody) axiosConfig.data = body;

      axiosConfig.timeout = 60000;
      axiosConfig.maxRedirects = 0;

      console.log("Preview Axios Config:", axiosConfig);

      let previewApiResponse: import("axios").AxiosResponse | undefined;
      let currentPreviewUrl = url;
      for (let hop = 0; hop <= 5; hop++) {
        axiosConfig.url = currentPreviewUrl;
        const r = await axios(axiosConfig);
        if (!REDIRECT_STATUSES_IDX.has(r.status)) {
          previewApiResponse = r;
          break;
        }
        const location = r.headers["location"];
        if (!location) throw new Error(`Redirect from "${currentPreviewUrl}" had no Location header.`);
        const nextUrl = new URL(location, currentPreviewUrl).toString();
        await assertOutboundFetchAllowed(nextUrl, previewPolicyOptions);
        currentPreviewUrl = nextUrl;
        if (hop === 5) throw new Error(`Too many redirects (>5) following "${url}".`);
      }
      const apiData = previewApiResponse!.data;
      rssXml = buildRSSFromApiData(apiData, feedConfig).xml;
    }
    return rssXml;
  } catch (error) {
    console.error(
      `Error fetching/processing data for preview feedId ${feedConfig.feedId}:`,
      error.message
    );
    // Re-throw the error to be handled by the calling route (/preview)
    // This allows the route to provide a more specific HTTP error response.
    throw error;
  }
}

function setFeedUpdaterInterval(feedConfig: any) {
  const feedId = feedConfig.feedId;

  if (!feedUpdaters.has(feedId)) {
    console.log("Initializing worker for feed:", feedId);
    initializeWorker(feedConfig);
    feedUpdaters.get(feedId).postMessage({
      command: "start",
      config: feedConfig,
      encryptionKey: encryptionKey,
    });
  }

  if (feedConfig.feedType !== "email") {
    if (!feedIntervals.has(feedId)) {
      console.log("Setting interval for feed:", feedId);

      const interval = setInterval(() => {
        console.log("Engaging worker for feed:", feedId);
        feedUpdaters
          .get(feedId)
          .postMessage({ command: "start", config: feedConfig });
      }, feedConfig.refreshTime * 60 * 1000);

      feedIntervals.set(feedId, interval);
    }
  }
}

function clearAllFeedUpdaterIntervals() {
  for (const [feedId, _intervalId] of feedIntervals.entries()) {
    clearFeedUpdaterInterval(feedId);

    const worker = feedUpdaters.get(feedId);
    if (worker) {
      worker.terminate();
      feedUpdaters.delete(feedId);
    }
  }
}

function clearFeedUpdaterInterval(feedId: string) {
  const interval = feedIntervals.get(feedId);
  if (interval) {
    clearInterval(interval);
    feedIntervals.delete(feedId);
  }
}

async function deleteFeed(feedId: string): Promise<boolean> {
  try {
    const feedFilePath = join("configs", `${feedId}.yaml`);
    await unlink(feedFilePath, (error) => {
      if (error) {
        console.error(`Failed to delete feed file ${feedId}.yaml:`, error);
      }
    });

    console.log(`Feed ${feedId} deleted.`);
    return true;
  } catch (error) {
    console.error(`Failed to delete feed ${feedId}:`, error);
    return false;
  }
}

export default {
  port: 5000,
  fetch: app.fetch,
  idleTimeout: 120, // 120 seconds to allow FlareSolverr requests to complete
};

process.on("exit", () => {
  clearAllFeedUpdaterIntervals();
});

process.on("SIGINT", () => {
  clearAllFeedUpdaterIntervals();
  process.exit();
});

process.on("SIGTERM", () => {
  clearAllFeedUpdaterIntervals();
  process.exit();
});
