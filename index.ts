import { file } from "bun";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import * as cookieSignature from "cookie-signature";
import { existsSync, mkdirSync, unlink } from "fs";
import { readFile, readdir, writeFile } from "fs/promises";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getConnInfo } from "hono/cloudflare-workers";
import { except } from "hono/combine";
import * as yaml from "js-yaml";
import minimist from "minimist";
import { basename, join } from "path";
import { v4 as uuidv4 } from "uuid";
import { DOMParser } from "xmldom";
import ApiConfig from "./models/apiconfig.model";
import CSSTarget from "./models/csstarget.model";
import axios from "axios";
import { createInterface } from "readline";
import { buildRSS, buildRSSFromApiData } from "./utilities/rss-builder.utility";
import { Config } from "node-imap";
import { listImapFolders } from "./utilities/imap.utility";
import { encrypt } from "./utilities/security.utility";
import puppeteer from "puppeteer";

const app = new Hono();
const args = minimist(process.argv.slice(3));

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
processFeedsAtStart();
//ALLOW LOCAL NETWORK TO ACCESS API
const middleware = async (_, next) => {
  const connInfo = await getConnInfo(_);
  if (
    connInfo?.remote?.address == undefined ||
    connInfo?.remote?.address === "127.0.0.1" ||
    connInfo?.remote?.address === "::1"
  ) {
    // Return after calling `await next()`
    return await next();
  } else {
    const cookies = parseCookie(_.req.header("Cookie") || "");
    const signedAuthToken = cookies["auth_token"];
    if (signedAuthToken) {
      const authToken = cookieSignature.unsign(signedAuthToken, cookieSecret);
      if (authToken === "authenticated") {
        // Return after calling `await next()`
        return await next();
      } else {
        // Handle invalid auth token
        // Clear the invalid cookie
        _.res.headers.append(
          "Set-Cookie",
          serializeCookie("auth_token", "", {
            secure: true, // Set to true if using HTTPS
            maxAge: 0,
            sameSite: "lax",
          })
        );
        // Redirect to passkey page
        return _.redirect("/passkey");
      }
    }

    if (_.req.method === "POST" && _.req.path === "/passkey") {
      // Handle passkey submission
      const data = await _.req.parseBody();
      const passKey = data["passkey"];
      if (passKey === passkey) {
        const signedValue = cookieSignature.sign("authenticated", cookieSecret);
        _.res.headers.append(
          "Set-Cookie",
          serializeCookie("auth_token", signedValue, {
            secure: true, // Set to true if using HTTPS
            maxAge: 60 * 60 * 24, // 1 day
            sameSite: "lax",
          })
        );
        return _.redirect("/");
      } else {
        return _.html(
          '<p>Incorrect passkey. <a href="/passkey">Try again</a>.</p>'
        );
      }
    } else if (_.req.path === "/passkey") {
      // Return after calling `await next()`
      return await next();
    } else {
      return _.redirect("/passkey");
    }
  }
};

app.use("/*", except("/public/feeds/*", middleware));
app.use("/public/*", serveStatic({ root: "./" }));
app.use("/configs/*", serveStatic({ root: "./" }));
app.get("/", (ctx) => ctx.html(file("./public/index.html").text()));
app.post("/", async (ctx) => {
  const feedId = uuidv4();
  const contentType = ctx.req.header("Content-Type") || "";

  let body: Record<string, any>;

  try {
    if (contentType.includes("application/json")) {
      body = await ctx.req.json();
    } else if (
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      const formData = await ctx.req.formData();
      body = Object.fromEntries(formData);
    } else {
      return ctx.text("Unsupported Content-Type.", 415);
    }
  } catch {
    return ctx.text("Invalid request body.", 400);
  }

  const extract = (key: string, fallback: any = undefined) =>
    body[key]?.toString() || fallback;

  const feedType = extract("feedType", "webScraping");
  
  const buildCSSTarget = (prefix: string) => {
    const dateFormat = extract(`${prefix}Format`);
    const customDateFormat =
      dateFormat === "other" ? extract("customDateFormat") : undefined;

    return new CSSTarget(
      extract(`${prefix}Selector`),
      extract(`${prefix}Attribute`),
      ["on", true, "true"].includes(extract(`${prefix}StripHtml`)),
      extract(`${prefix}BaseUrl`),
      ["on", true, "true"].includes(extract(`${prefix}RelativeLink`)),
      ["on", true, "true"].includes(extract(`${prefix}TitleCase`)),
      extract(`${prefix}Iterator`),
      dateFormat === "other" ? customDateFormat : dateFormat
    );
  };
  const apiConfig: ApiConfig = {
    title: extract("feedName", "RSS Feed"),
    baseUrl: extract("feedUrl"),
    method: extract("apiMethod", "GET"),
    route: extract("apiRoute"),
    params: JSON.parse(extract("apiParams", "{}")),
    headers: JSON.parse(extract("apiHeaders", "{}")),
    body: JSON.parse(extract("apiBody", "{}")),
    advanced: ["on", true, "true"].includes(extract("advanced")),
  };

  const emailConfig = {
    host: extract("emailHost"),
    port: parseInt(extract("emailPort", "993")),
    user: extract("emailUsername"),
    encryptedPassword: encrypt(extract("emailPassword"), encryptionKey),
    folder: extract("emailFolder"),
  };

  const feedConfig = {
    feedId,
    feedName: apiConfig.title,
    feedType,
    config: feedType === "email" ? emailConfig : apiConfig,
    article:
      feedType === "webScraping"
        ? {
            iterator: new CSSTarget(extract("itemSelector")),
            title: buildCSSTarget("title"),
            description: buildCSSTarget("description"),
            link: buildCSSTarget("link"),
            enclosure: buildCSSTarget("enclosure"),
            date: buildCSSTarget("date"),
            headers: extract("headers"),
          }
        : {},
    apiMapping:
      feedType === "api"
        ? {
            items: extract("apiItemsPath"),
            title: extract("apiTitleField"),
            description: extract("apiDescriptionField"),
            link: extract("apiLinkField"),
            date: extract("apiDateField"),
          }
        : {},
    refreshTime: parseInt(extract("refreshTime", "5")),
    reverse: ["on", true, "true"].includes(extract("reverse")),
    strict: ["on", true, "true"].includes(extract("strict")),
  };

  const yamlStr = yaml.dump(feedConfig);
  const yamlFilePath = join(configsDir, `${feedId}.yaml`);
  await writeFile(yamlFilePath, yamlStr, "utf8");

  setFeedUpdaterInterval(feedConfig);

  if (contentType.includes("application/json")) {
    return ctx.json({
      message: "RSS feed is being generated.",
      feedUrl: `public/feeds/${feedId}.xml`,
    });
  }

  return ctx.html(`
    <p>Your RSS feed is being generated and will update every ${feedConfig.refreshTime} minutes.</p>
    <p>Access it at: <a href=\"public/feeds/${feedId}.xml\">public/feeds/${feedId}.xml</a></p>
  `);
});

app.post("/preview", async (ctx) => {
  try {
    const jsonData = await ctx.req.json();

    const extract = (key: string, fallback: any = undefined) =>
      jsonData[key] ?? fallback;

    const buildCSSTarget = (prefix: string) => {
      const dateFormat = extract(`${prefix}Format`);
      const customDateFormat =
        dateFormat === "other" ? extract("customDateFormat") : undefined;

      return new CSSTarget(
        extract(`${prefix}Selector`),
        extract(`${prefix}Attribute`),
        ["on", true, "true"].includes(extract(`${prefix}StripHtml`)),
        extract(`${prefix}BaseUrl`),
        ["on", true, "true"].includes(extract(`${prefix}RelativeLink`)),
        ["on", true, "true"].includes(extract(`${prefix}TitleCase`)),
        extract(`${prefix}Iterator`),
        // Pass either the standard date format or the custom format
        dateFormat === "other" ? customDateFormat : dateFormat
      );
    };

    const feedType = extract("feedType", "webScraping");

    const apiConfig: ApiConfig = {
      title: extract("feedName", "RSS Feed"),
      baseUrl: extract("feedUrl"),
      method: extract("apiMethod", "GET"),
      route: extract("apiRoute"),
      params: JSON.parse(extract("apiParams", "{}")),
      headers: JSON.parse(extract("apiHeaders", "{}")),
      body: JSON.parse(extract("apiBody", "{}")),
      advanced: ["on", true, "true"].includes(extract("advanced")),
    };

    const emailConfig = {
      host: extract("emailHost"),
      port: parseInt(extract("emailPort", "993")),
      username: extract("emailUsername"),
      encryptedPassword: encrypt(extract("emailPassword"), encryptionKey),
      folder: extract("emailFolder"),
    };

    const feedConfig = {
      feedId: "preview",
      feedName: apiConfig.title,
      feedType,
      config: apiConfig,
      article:
        feedType === "webScraping"
          ? {
              iterator: new CSSTarget(extract("itemSelector")),
              title: buildCSSTarget("title"),
              description: buildCSSTarget("description"),
              link: buildCSSTarget("link"),
              author: buildCSSTarget("author"),
              date: buildCSSTarget("date"),
              enclosure: buildCSSTarget("enclosure"),
            }
          : {},
      apiMapping:
        feedType === "api"
          ? {
              items: extract("apiItemsPath"),
              title: extract("apiTitleField"),
              description: extract("apiDescriptionField"),
              link: extract("apiLinkField"),
              date: extract("apiDateField"),
            }
          : {},
      refreshTime: parseInt(extract("refreshTime", "5")),
      reverse: ["on", true, "true"].includes(extract("reverse")),
      strict: ["on", true, "true"].includes(extract("strict")),
    };

    const response = await generatePreview(feedConfig);

    return ctx.text(response, 200, {
      "Content-Type": "application/rss+xml",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
  } catch (error) {
    console.error("Error generating preview:", error);
    return ctx.text("Invalid request.", 400);
  }
});

//GPT ONLY ENDPOINT TO GET HTML AND DETERMINE BEST CSS SELECTORS
// app.post('/html', async (ctx) => {
//   //Axios request from url in request body
//   let jsonData = await ctx.req.json();
//   let url = jsonData.url;
//   await axios.get(url)
//     .then(async (response) => {
//       // Process the response stream
//       let data = Buffer.from(response.data, 'utf-8');
//       let compressed = gzipSync(data);
//       await Bun.write("./public/html.gz", compressed);
//     })
//   let text = await file('./public/html.gz').text()
//   return ctx.body(text);
// });

app.get("/feeds", async (ctx) => {
  const files = await readdir(configsDir);
  const yamlFiles = files.filter((file) => file.endsWith(".yaml"));
  const configs = [];

  // Read feed configurations
  for (const file of yamlFiles) {
    const filePath = join(configsDir, file);
    const yamlContent = await readFile(filePath, "utf8");
    const feedConfig = yaml.load(yamlContent);
    configs.push(feedConfig);
  }

  // Start building the HTML response
  let response = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Feeds</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    </head>
    <body>
      <main class="container">
        <script>
          function confirmDelete(feedId) {
            return confirm("Are you sure you want to delete this feed?");
          }
        </script>
        <header style="text-align:center;"><h1>Active RSS Feeds</h1></header>
        <div>
  `;

  // Process each feed to extract information
  for (const config of configs) {
    const feedId = config.feedId;
    const feedName = config.feedName;
    const feedType = config.feedType;

    // Read the corresponding XML file
    const xmlFilePath = join(feedPath, `${feedId}.xml`);
    let lastBuildDate = "N/A";
    try {
      const xmlContent = await readFile(xmlFilePath, "utf8");
      // Parse the XML to extract lastBuildDate
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
      const lastBuildDateNode = xmlDoc.getElementsByTagName("lastBuildDate")[0];
      if (lastBuildDateNode && lastBuildDateNode.textContent) {
        lastBuildDate = new Date(
          lastBuildDateNode.textContent
        ).toLocaleString();
      }
    } catch (error) {
      console.error(`Error reading XML for feedId ${feedId}:`, error);
    }

    // Build the card for this feed
    response += `
      <article>
        <header>
          <h2>${feedName}</h2>
        </header>
        <p><strong>Feed ID:</strong> ${feedId}</p>
        <p><strong>Build Time:</strong> ${lastBuildDate}</p>
        <p><strong>Feed Type:</strong> ${feedType}</p>
        <footer>
        <div class="grid">
            <a href="public/feeds/${feedId}.xml" style="margin-right: auto;line-height:3em;">View Feed</a>
            <form action="/delete-feed" method="POST" style="display:inline;" onsubmit="return confirmDelete('${feedId}')">
              <input type="hidden" name="feedId" value="${feedId}">
              <button type="submit" style="width:25%;margin-left:auto;float:right;" class="outline contrast">Delete</button>
          </div>
          </form>
        </footer>
      </article>
    `;
  }

  // Close the grid and body
  response += `
        </div>
      </main>
    </body>
    </html>
  `;

  return ctx.html(response);
});

function injectSelectorGadget(html: string): string {
  const SG_SCRIPT = `
  <script>
    (function() {
        let s = document.createElement("div");
        s.innerHTML = "Loading...";
        s.style.color = "black";
        s.style.padding = "20px";
        s.style.position = "fixed";
        s.style.zIndex = "9999";
        s.style.fontSize = "3.0em";
        s.style.border = "2px%20solid%20black";
        s.style.right = "40px";
        s.style.top = "40px";
        s.setAttribute("class", "selector_gadget_loading");
        s.style.background = "white";
        document.body.appendChild(s);
        s = document.createElement("script");
        s.setAttribute("type", "text/javascript");
        s.setAttribute(
          "src",
          "https://dv0akt2986vzh.cloudfront.net/unstable/lib/selectorgadget.js"
        );
        document.body.appendChild(s);
    })();
  </script>
`;

  let modified = html;
  if (modified.includes("</body>")) {
    modified = modified.replace("</body>", SG_SCRIPT + "\n</body>");
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

  try {
    const response = await axios.get(targetUrl);
    let html = response.data;

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

app.post("/passkey", async (c) => {});

app.post("/delete-feed", async (c) => {
  const data = await c.req.parseBody();
  const feedId = data["feedId"];

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

app.post("/imap/folders", async (c) => {
  const config = await c.req.json<Config>();
  console.log("IMAP config:", config);
  const folders = await listImapFolders(config);
  console.log("IMAP folders:", folders);
  return c.json({ folders });
});

app.get("privacy-policy", (ctx) =>
  ctx.html(
    `We only keep the data you provide for generating RSS feeds. We do not store any personal information.`
  )
);

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

  feedUpdaters.get(feedConfig.feedId).onmessage = (message) => {
    if (message.data.status === "done") {
      console.log(`Feed updates completed for ${feedConfig.feedId}.`);
    } else if (message.data.status === "error") {
      console.error(
        `Feed updates for ${feedConfig.feedId} encountered an error:`,
        message.data.error
      );
    }
  };

  feedUpdaters.get(feedConfig.feedId).onerror = (error) => {
    console.error("Worker error:", error);
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

    if (feedConfig.feedType === "webScraping") {
      // If advanced is true, use Puppeteer
      if (feedConfig.config.advanced) {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(feedConfig.config.baseUrl, {
          waitUntil: "networkidle2",
        });
        const html = await page.content();
        await browser.close();
        rssXml = await buildRSS(
          html,
          feedConfig
        );
      } else {
        // Otherwise, use axios
        const response = feedConfig.article?.headers
          ? await axios.get(feedConfig.config.baseUrl, {
              headers: feedConfig.article.headers,
            })
          : await axios.get(feedConfig.config.baseUrl);
        const html = response.data;
        rssXml = await buildRSS(
          html,
          feedConfig
        );
      }
    } else if (feedConfig.feedType === "api") {
      const axiosConfig = {
        method: feedConfig.config.method || "GET",
        url: feedConfig.config.baseUrl + (feedConfig.config.route || ""),
        headers: feedConfig.config.headers || {},
        params: feedConfig.config.params || {},
        data: feedConfig.config.body || {},
        withCredentials: feedConfig.config.withCredentials || false,
      };

      console.log("axiosConfig:", axiosConfig);
      const response = await axios(axiosConfig);
      const apiData = response.data;

      rssXml = buildRSSFromApiData(
        apiData,
        feedConfig,
      );
    }
    return rssXml;
  } catch (error) {
    console.error(
      `Error fetching data for feedId ${feedConfig.feedId}:`,
      error.message
    );
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
  for (const [feedId, intervalId] of feedIntervals.entries()) {
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
