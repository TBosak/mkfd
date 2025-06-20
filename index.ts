import { file } from "bun";
import { existsSync, mkdirSync, unlink } from "fs";
import { readFile, readdir, writeFile } from "fs/promises";
import { Context, Hono } from "hono";
import { serveStatic, getConnInfo } from "hono/bun";
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
import { CookieStore, sessionMiddleware } from "hono-sessions";
import { suggestSelectors } from "./utilities/suggestion-engine.utility";
import { parseCookiesForPlaywright } from "./utilities/data-handler.utility";
import { chromium } from "patchright";
import * as cheerio from "cheerio";

const app = new Hono();
const store = new CookieStore();
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
    const inputKey = body["passkey"];

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

      const potentialDrillChainKeys = Object.keys(body).filter(k => k.includes("DrillChain"));
      const structuredDrillChains: Record<string, any[]> = {};

      for (const key of potentialDrillChainKeys) {
        const drillChainMatch = key.match(/^(\w+)DrillChain\[(\d+)\]\[(\w+)\]$/);
        if (drillChainMatch) {
          const fieldName = drillChainMatch[1];
          const index = parseInt(drillChainMatch[2]);
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
        const response = await axios.get(body.feedUrl, {
          maxContentLength: 2 * 1024 * 1024,
          maxBodyLength: 2 * 1024 * 1024,
        });
        sampleHtml = response.data;
      } catch (e) {
        console.warn("Could not fetch sample HTML for URL analysis:", e.message);
        sampleHtml = "";
      }
    }

  } catch (e) {
    console.error("Error parsing request body:", e);
    return ctx.text("Invalid request body.", 400);
  }

  const extract = (key: string, fallback: any = undefined) => {
    return body[key] ?? fallback;
  }

  const extractBool = (key: string, fallback: boolean = false) => {
    const val = extract(key);
    if (val === undefined) return fallback;
    if (typeof val === 'boolean') return val;
    return ["on", "true", "checked"].includes(String(val).toLowerCase());
  };

  const extractJson = (key: string, fallback: any = {}) => {
    const val = extract(key);
    if (typeof val === 'object' && val !== null) return val; 
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        console.warn(`Failed to parse JSON for key: ${key}, value: ${val}`);
        return fallback; 
      }
    }
    return fallback; 
  };
  
  const cookieNames = extract("cookieNames", []) as string[];
  const cookieValues = extract("cookieValues", []) as string[];
  const cookies = cookieNames.map((name, i) => ({ name: name.trim(), value: (cookieValues[i] ?? "").trim() })).filter(c => c.name);

  const feedType = extract("feedType", "webScraping");
  const feedName = extract("feedName", "RSS Feed");

  let configData: any = {}; 
  let articleData: any = {}; 
  let apiMappingData: any = {}; 
  let emailConfigData: any = {}; 

  const feedOptions = {
    feedLanguage: "",
    feedCopyright: "",
    feedDescription: "",
    feedManagingEditor: "",
    feedWebMaster: "",
    feedPubDate: "", 
    feedLastBuildDate: "",
    feedCategories: [] as string[], 
    feedDocs: "https://www.rssboard.org/rss-specification", 
    feedGenerator: "MkFD Feed Generator", 
    feedTtl: undefined as number | undefined, 
    feedRating: "",
    feedSkipHours: [] as number[], 
    feedSkipDays: [] as string[], 
    feedImage: undefined as { url: string; title: string; link: string; width?: number; height?: number; description?: string } | undefined,
  };

  if (feedType === "webScraping") {
    configData = {
      baseUrl: extract("feedUrl"), 
    };
    articleData = {
      iterator: await buildCSSTarget("item", body, sampleHtml), 
      title: await buildCSSTarget("title", body, sampleHtml),
      link: await buildCSSTarget("link", body, sampleHtml),
      description: await buildCSSTarget("description", body, sampleHtml),
      author: await buildCSSTarget("author", body, sampleHtml),
      categories: await buildCSSTarget("categories", body, sampleHtml), 
      comments: await buildCSSTarget("commentsUrl", body, sampleHtml), 
      enclosure: await buildCSSTarget("enclosure", body, sampleHtml),
      guid: await buildCSSTarget("guid", body, sampleHtml), 
      pubDate: await buildCSSTarget("date", body, sampleHtml), 
      source: {
        title: await buildCSSTarget("sourceTitle", body, sampleHtml),
        url: await buildCSSTarget("sourceUrl", body, sampleHtml),
      },
      contentEncoded: await buildCSSTarget("contentEncoded", body, sampleHtml),
      summary: await buildCSSTarget("summary", body, sampleHtml),
      contributors: await buildCSSTarget("contributors", body, sampleHtml),
      lat: await buildCSSTarget("lat", body, sampleHtml),
      long: await buildCSSTarget("long", body, sampleHtml),
    };

    feedOptions.feedLanguage = extract("feedLanguageSelector") ? `${extract("feedLanguageSelector")}${extract("feedLanguageAttribute", "") ? `|attr:${extract("feedLanguageAttribute")}` : ""}` : "";
    feedOptions.feedCopyright = extract("feedCopyrightSelector") ? `${extract("feedCopyrightSelector")}${extract("feedCopyrightAttribute", "") ? `|attr:${extract("feedCopyrightAttribute")}` : ""}` : "";
    feedOptions.feedManagingEditor = extract("feedManagingEditorSelector") ? `${extract("feedManagingEditorSelector")}${extract("feedManagingEditorAttribute", "") ? `|attr:${extract("feedManagingEditorAttribute")}` : ""}` : "";
    feedOptions.feedWebMaster = extract("feedWebMasterSelector") ? `${extract("feedWebMasterSelector")}${extract("feedWebMasterAttribute", "") ? `|attr:${extract("feedWebMasterAttribute")}` : ""}` : "";
    
    const feedCategoriesScraped = extract("feedCategoriesScrapingSelector") ? `${extract("feedCategoriesScrapingSelector")}${extract("feedCategoriesScrapingAttribute", "") ? `|attr:${extract("feedCategoriesScrapingAttribute")}` : ""}` : "";
    if (feedCategoriesScraped) feedOptions.feedCategories = [feedCategoriesScraped]; 

    const feedTtlScraped = extract("feedTtlSelector") ? `${extract("feedTtlSelector")}${extract("feedTtlAttribute", "") ? `|attr:${extract("feedTtlAttribute")}` : ""}` : "";
    if (feedTtlScraped) feedOptions.feedTtl = Number(feedTtlScraped); 
    
    feedOptions.feedRating = extract("feedRatingSelector") ? `${extract("feedRatingSelector")}${extract("feedRatingAttribute", "") ? `|attr:${extract("feedRatingAttribute")}` : ""}` : "";
    
    const skipDaysScraped = extract("feedSkipDaysSelector") ? `${extract("feedSkipDaysSelector")}${extract("feedSkipDaysAttribute", "") ? `|attr:${extract("feedSkipDaysAttribute")}` : ""}` : "";
    if (skipDaysScraped) feedOptions.feedSkipDays = [skipDaysScraped]; 

    const skipHoursScraped = extract("feedSkipHoursSelector") ? `${extract("feedSkipHoursSelector")}${extract("feedSkipHoursAttribute", "") ? `|attr:${extract("feedSkipHoursAttribute")}` : ""}` : "";
    if (skipHoursScraped) feedOptions.feedSkipHours = [Number(skipHoursScraped)]; 

    const imgUrlSel = extract("feedImageUrlSelector");
    if (imgUrlSel) {
      feedOptions.feedImage = {
        url: `${imgUrlSel}${extract("feedImageUrlAttribute", "") ? `|attr:${extract("feedImageUrlAttribute")}` : ""}`,
        title: extract("feedImageTitleSelector") ? `${extract("feedImageTitleSelector")}${extract("feedImageTitleAttribute", "") ? `|attr:${extract("feedImageTitleAttribute")}` : ""}` : "",
        link: extract("feedImageLinkSelector") ? `${extract("feedImageLinkSelector")}${extract("feedImageLinkAttribute", "") ? `|attr:${extract("feedImageLinkAttribute")}` : ""}` : "",
        width: extract("feedImageWidthSelector") ? Number(`${extract("feedImageWidthSelector")}${extract("feedImageWidthAttribute", "") ? `|attr:${extract("feedImageWidthAttribute")}` : ""}`) : undefined,
        height: extract("feedImageHeightSelector") ? Number(`${extract("feedImageHeightSelector")}${extract("feedImageHeightAttribute", "") ? `|attr:${extract("feedImageHeightAttribute")}` : ""}`) : undefined,
        description: extract("feedImageDescriptionSelector") ? `${extract("feedImageDescriptionSelector")}${extract("feedImageDescriptionAttribute", "") ? `|attr:${extract("feedImageDescriptionAttribute")}` : ""}` : "",
      };
    }

  } else if (feedType === "api") {
    configData = {
      baseUrl: extract("feedUrl"),
      method: extract("apiMethod", "GET"),
      route: extract("apiRoute"),
      params: extractJson("apiParams"),
      apiSpecificHeaders: extractJson("apiHeaders"), 
      apiSpecificBody: extractJson("apiBody"),     
    };
    apiMappingData = {
      items: extract("apiItemsPath"),
      title: extract("apiTitleField"), 
      link: extract("apiLinkField"),
      description: extract("apiDescriptionField"),
      author: extract("apiAuthor"),
      categories: extract("apiCategories"),      
      comments: extract("apiCommentsUrl"), 
      enclosureUrl: extract("apiEnclosureUrl"),
      enclosureLength: extract("apiEnclosureSize"), 
      enclosureType: extract("apiEnclosureType"),
      guid: extract("apiGuid"),
      guidIsPermaLink: extract("apiGuidIsPermaLink"), 
      pubDate: extract("apiDateField"), 
      sourceTitle: extract("apiSourceTitle"),
      sourceUrl: extract("apiSourceUrl"),
      contentEncoded: extract("apiContentEncoded"),
      summary: extract("apiSummary"),
      contributors: extract("apiContributors"),
      lat: extract("apiLat"),
      long: extract("apiLong"),
      feedTitlePath: extract("apiFeedTitle"),
      feedLinkPath: extract("feedUrl"), 
      feedDescriptionPath: extract("apiFeedDescription"),
      feedLanguagePath: extract("apiFeedLanguage"),
      feedCopyrightPath: extract("apiFeedCopyright"),
      feedManagingEditorPath: extract("apiFeedManagingEditor"),
      feedWebMasterPath: extract("apiFeedWebMaster"),
      feedPubDatePath: extract("apiFeedPubDate"),
      feedLastBuildDatePath: extract("apiFeedLastBuildDate"),
      feedCategoriesPath: extract("apiFeedCategories"), 
      feedTtlPath: extract("apiFeedTtl"), 
      feedRatingPath: extract("apiFeedRating"),
      feedSkipHoursPath: extract("apiFeedSkipHours"), 
      feedSkipDaysPath: extract("apiFeedSkipDays"),   
      feedImageUrlPath: extract("apiFeedImageUrl"),
      feedImageTitlePath: extract("apiFeedImageTitle"),
      feedImageLinkPath: extract("apiFeedImageLink"),
      feedImageWidthPath: extract("apiFeedImageWidth"), 
      feedImageHeightPath: extract("apiFeedImageHeight"), 
      feedImageDescriptionPath: extract("apiFeedImageDescription"),
    };

  } else if (feedType === "email") {
    emailConfigData = {
      host: extract("emailHost"),
      port: parseInt(extract("emailPort", "993")) || 993,
      user: extract("emailUsername"),
      encryptedPassword: encrypt(extract("emailPassword"), encryptionKey),
      folder: extract("emailFolder"),
    };
    feedOptions.feedLanguage = "en"; 
    feedOptions.feedDescription = `Emails from folder: ${emailConfigData.folder}`;
  }

  const finalFeedConfig = {
    feedId,
    feedName,
    feedType,
    refreshTime: parseInt(extract("refreshTime", "5")) || 5,
    reverse: extractBool("reverse"),
    strict: extractBool("strict"),
    advanced: extractBool("advanced"), 
    headers: extractJson("headers"),   
    cookies: cookies.length > 0 ? cookies : undefined, 
    
    config: feedType === "email" ? emailConfigData : configData, 
    ...(feedType === "webScraping" && { article: articleData }), 
    ...(feedType === "api" && { apiMapping: apiMappingData }),     
    
    ...feedOptions 
  };

  const yamlStr = yaml.dump(finalFeedConfig);
  const yamlFilePath = join(configsDir, `${feedId}.yaml`);
  await writeFile(yamlFilePath, yamlStr, "utf8");

  setFeedUpdaterInterval(finalFeedConfig);

  if (contentType.includes("application/json")) {
    return ctx.json({
      message: "RSS feed is being generated.",
      feedUrl: `public/feeds/${feedId}.xml`,
      feedId: feedId,
      config: finalFeedConfig 
    });
  }

  return ctx.html(`
    <p>Your RSS feed is being generated and will update every ${finalFeedConfig.refreshTime} minutes.</p>
    <p>Access it at: <a href=\"/public/feeds/${feedId}.xml\">/public/feeds/${feedId}.xml</a></p>
    <p><a href="/feeds">View all feeds</a></p>
  `);
});

app.post("/preview", async (ctx) => {
  try {
    const jsonData = await ctx.req.json();

    const extract = (key: string, fallback: any = undefined) => jsonData[key] ?? fallback;
    const extractBool = (key: string, fallback: boolean = false) => {
        const val = jsonData[key];
        if (val === undefined) return fallback;
        if (typeof val === 'boolean') return val;
        return ["on", "true", "checked"].includes(String(val).toLowerCase());
    };
    const extractJson = (key: string, fallback: any = {}) => {
        const val = jsonData[key];
        if (typeof val === 'object' && val !== null) return val;
        if (typeof val === 'string') {
            try { return JSON.parse(val); } catch { return fallback; }
        }
        return fallback;
    };

    const feedType = extract("feedType", "webScraping");
    const feedName = extract("feedName", "RSS Feed");

    let sampleHtml = "";
    if (feedType === "webScraping" && extract("feedUrl")) {
      try {
        const response = await axios.get(extract("feedUrl"), {
          maxContentLength: 2 * 1024 * 1024,
          maxBodyLength: 2 * 1024 * 1024,
        });
        sampleHtml = response.data;
      } catch (e) {
        console.warn("Could not fetch sample HTML for preview:", e.message);
        sampleHtml = "";
      }
    }

    const cookieNames = extract("cookieNames", []) as string[];
    const cookieValues = extract("cookieValues", []) as string[];
    const cookies = cookieNames.map((name, i) => ({ name: name.trim(), value: (cookieValues[i] ?? "").trim() })).filter(c => c.name);

    let configData: any = {};
    let articleData: any = {};
    let apiMappingData: any = {};
    // No emailConfigData for preview as it involves live connections not suitable for simple preview

    const feedOptions = {
        feedLanguage: "",
        feedCopyright: "",
        feedDescription: "",
        feedManagingEditor: "",
        feedWebMaster: "",
        feedPubDate: "",
        feedLastBuildDate: "",
        feedCategories: [] as string[],
        feedDocs: "https://www.rssboard.org/rss-specification",
        feedGenerator: "MkFD Preview Generator",
        feedTtl: undefined as number | undefined,
        feedRating: "",
        feedSkipHours: [] as number[],
        feedSkipDays: [] as string[],
        feedImage: undefined as { url: string; title: string; link: string; width?: number; height?: number; description?: string } | undefined,
    };

    if (feedType === "webScraping") {
        configData = {
            baseUrl: extract("feedUrl"),
        };
        articleData = {
            iterator: await buildCSSTarget("item", jsonData, sampleHtml),
            title: await buildCSSTarget("title", jsonData, sampleHtml),
            link: await buildCSSTarget("link", jsonData, sampleHtml),
            description: await buildCSSTarget("description", jsonData, sampleHtml),
            author: await buildCSSTarget("author", jsonData, sampleHtml),
            categories: await buildCSSTarget("categories", jsonData, sampleHtml),
            comments: await buildCSSTarget("commentsUrl", jsonData, sampleHtml),
            enclosure: await buildCSSTarget("enclosure", jsonData, sampleHtml),
            guid: await buildCSSTarget("guid", jsonData, sampleHtml),
            pubDate: await buildCSSTarget("date", jsonData, sampleHtml),
            source: {
                title: await buildCSSTarget("sourceTitle", jsonData, sampleHtml),
                url: await buildCSSTarget("sourceUrl", jsonData, sampleHtml),
            },
            contentEncoded: await buildCSSTarget("contentEncoded", jsonData, sampleHtml),
            summary: await buildCSSTarget("summary", jsonData, sampleHtml),
            contributors: await buildCSSTarget("contributors", jsonData, sampleHtml),
            lat: await buildCSSTarget("lat", jsonData, sampleHtml),
            long: await buildCSSTarget("long", jsonData, sampleHtml),
        };

        // Feed-level from selectors - for preview, these are direct values if simple, or selectors if complex
        // For simplicity in preview, we might assume direct values for some, or rely on worker to fully parse selectors for live feeds.
        // The rss-builder utility will attempt to use these values directly.
        feedOptions.feedLanguage = extract("feedLanguageSelector"); // Assumes this provides a direct value for preview
        feedOptions.feedCopyright = extract("feedCopyrightSelector");
        feedOptions.feedManagingEditor = extract("feedManagingEditorSelector");
        feedOptions.feedWebMaster = extract("feedWebMasterSelector");
        const feedCategoriesPreview = extract("feedCategoriesScrapingSelector");
        if (feedCategoriesPreview) feedOptions.feedCategories = feedCategoriesPreview.split(',').map(s => s.trim());
        const feedTtlPreview = extract("feedTtlSelector");
        if (feedTtlPreview) feedOptions.feedTtl = Number(feedTtlPreview);
        feedOptions.feedRating = extract("feedRatingSelector");
        const skipDaysPreview = extract("feedSkipDaysSelector");
        if (skipDaysPreview) feedOptions.feedSkipDays = skipDaysPreview.split(',').map(s => s.trim());
        const skipHoursPreview = extract("feedSkipHoursSelector");
        if (skipHoursPreview) feedOptions.feedSkipHours = skipHoursPreview.split(',').map(s => Number(s.trim()));

        const imgUrlPreview = extract("feedImageUrlSelector");
        if (imgUrlPreview) {
            feedOptions.feedImage = {
                url: imgUrlPreview,
                title: extract("feedImageTitleSelector"),
                link: extract("feedImageLinkSelector"),
                width: extract("feedImageWidthSelector") ? Number(extract("feedImageWidthSelector")) : undefined,
                height: extract("feedImageHeightSelector") ? Number(extract("feedImageHeightSelector")) : undefined,
                description: extract("feedImageDescriptionSelector"),
            };
        }
    } else if (feedType === "api") {
        configData = {
            baseUrl: extract("feedUrl"),
            method: extract("apiMethod", "GET"),
            route: extract("apiRoute"),
            params: extractJson("apiParams"),
            apiSpecificHeaders: extractJson("apiHeaders"),
            apiSpecificBody: extractJson("apiBody"),
        };
        apiMappingData = {
            items: extract("apiItemsPath"),
            title: extract("apiTitleField"),
            link: extract("apiLinkField"),
            description: extract("apiDescriptionField"),
            author: extract("apiAuthor"),
            categories: extract("apiCategories"),
            comments: extract("apiCommentsUrl"),
            enclosureUrl: extract("apiEnclosureUrl"),
            enclosureLength: extract("apiEnclosureSize"),
            enclosureType: extract("apiEnclosureType"),
            guid: extract("apiGuid"),
            guidIsPermaLink: extract("apiGuidIsPermaLink"),
            pubDate: extract("apiDateField"),
            sourceTitle: extract("apiSourceTitle"),
            sourceUrl: extract("apiSourceUrl"),
            contentEncoded: extract("apiContentEncoded"),
            summary: extract("apiSummary"),
            contributors: extract("apiContributors"),
            lat: extract("apiLat"),
            long: extract("apiLong"),
            // Feed level mappings from API paths (worker handles full resolution for live feed)
            // For preview, rss-builder will use these paths to attempt extraction
            feedTitlePath: extract("apiFeedTitle"),
            feedLinkPath: extract("feedUrl"), // Usually the feedUrl itself for API
            feedDescriptionPath: extract("apiFeedDescription"),
            feedLanguagePath: extract("apiFeedLanguage"),
            feedCopyrightPath: extract("apiFeedCopyright"),
            feedManagingEditorPath: extract("apiFeedManagingEditor"),
            feedWebMasterPath: extract("apiFeedWebMaster"),
            feedPubDatePath: extract("apiFeedPubDate"),
            feedLastBuildDatePath: extract("apiFeedLastBuildDate"),
            feedCategoriesPath: extract("apiFeedCategories"),
            feedTtlPath: extract("apiFeedTtl"),
            feedRatingPath: extract("apiFeedRating"),
            feedSkipHoursPath: extract("apiFeedSkipHours"),
            feedSkipDaysPath: extract("apiFeedSkipDays"),
            feedImageUrlPath: extract("apiFeedImageUrl"),
            feedImageTitlePath: extract("apiFeedImageTitle"),
            feedImageLinkPath: extract("apiFeedImageLink"),
            feedImageWidthPath: extract("apiFeedImageWidth"),
            feedImageHeightPath: extract("apiFeedImageHeight"),
            feedImageDescriptionPath: extract("apiFeedImageDescription"),
        };
        // For API previews, feedOptions are largely derived by rss-builder from apiMappingData paths
    }

    const feedConfig = {
        feedId: "preview",
        feedName,
        feedType,
        refreshTime: parseInt(extract("refreshTime", "5")) || 5,
        reverse: extractBool("reverse"),
        strict: extractBool("strict"),
        advanced: extractBool("advanced"),
        headers: extractJson("headers"),
        cookies: cookies.length > 0 ? cookies : undefined,
        config: configData,
        ...(feedType === "webScraping" && { article: articleData }),
        ...(feedType === "api" && { apiMapping: apiMappingData }),
        ...feedOptions,
    };

    const response = await generatePreview(feedConfig);

    return ctx.text(response, 200, {
        "Content-Type": "application/rss+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate",
    });
  } catch (error) {
    console.error("Error generating preview:", error);
    // Check if error is an Axios error or similar with a response object
    if (error.response && error.response.data) {
        console.error("Error response data:", error.response.data);
        return ctx.text(`Error generating preview: ${error.message}. Server responded with: ${JSON.stringify(error.response.data)}`, 400);
    } else if (error.request) {
        console.error("Error request data:", error.request);
        return ctx.text(`Error generating preview: ${error.message}. No response received from server.`, 400);
    }
    return ctx.text(`Error generating preview: ${error.message}`, 400);
  }
});

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

app.post("/utils/suggest-selectors", async (c) => {
  const { url } = await c.req.json();
  try {
    const selectors = await suggestSelectors(url);
    return c.json(selectors);
  } catch (err) {
    return c.json({ error: err.message }, 500);
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

function isLikelyAbsoluteUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("//");
}

async function determineIsRelativeAndBaseUrl(
  url: string,
  userIsRelative: boolean | undefined,
  userBaseUrl: string | undefined,
  feedUrl: string | undefined
): Promise<{ isRelative: boolean, baseUrl: string | undefined }> {
  if (typeof userIsRelative === "boolean" && userBaseUrl) {
    return { isRelative: userIsRelative, baseUrl: userBaseUrl };
  }
  if (typeof userIsRelative === "boolean") {
    if (userIsRelative && !userBaseUrl && feedUrl) {
      return { isRelative: true, baseUrl: feedUrl };
    }
    return { isRelative: userIsRelative, baseUrl: userBaseUrl };
  }
  if (userBaseUrl) {
    if (isLikelyAbsoluteUrl(url)) {
      return { isRelative: false, baseUrl: userBaseUrl };
    } else {
      return { isRelative: true, baseUrl: userBaseUrl };
    }
  }
  if (isLikelyAbsoluteUrl(url)) {
    try {
      const resp = await axios.head(url, { maxRedirects: 2, validateStatus: () => true });
      if (resp.status >= 200 && resp.status < 600) {
        return { isRelative: false, baseUrl: undefined };
      }
    } catch {
      if (feedUrl) return { isRelative: true, baseUrl: feedUrl };
      return { isRelative: true, baseUrl: undefined };
    }
    if (feedUrl) return { isRelative: true, baseUrl: feedUrl };
    return { isRelative: true, baseUrl: undefined };
  }
  if (feedUrl) return { isRelative: true, baseUrl: feedUrl };
  return { isRelative: true, baseUrl: undefined };
}

function extractSampleUrlFromHtml(html: string, selector: string, attribute?: string): string {
  const $ = cheerio.load(html);
  const el = $(selector).first();
  if (!el.length) return "";
  if (attribute) {
    return el.attr(attribute) || "";
  }
  return el.attr("href") || el.attr("src") || "";
}

async function buildCSSTarget(prefix: string, body: Record<string, any>, sampleHtml?: string): Promise<CSSTarget> {
  const extractField = (suffix: string, fallback: any = "") => body[`${prefix}${suffix}`] ?? fallback;
  const extractBoolField = (suffix: string, fallback: boolean = false) => {
    const val = body[`${prefix}${suffix}`];
    if (val === undefined) return fallback;
    if (typeof val === 'boolean') return val;
    return ["on", "true", "checked"].includes(String(val).toLowerCase());
  };

  const selector = extractField("Selector");
  const attribute = extractField("Attribute");
  let userIsRelative = extractBoolField("RelativeLink", undefined);
  let userBaseUrl = extractField("BaseUrl", undefined);

  let isRelative = userIsRelative;
  let baseUrl = userBaseUrl;

  // Only apply to link, enclosure, sourceUrl
  if (["link", "enclosure", "sourceUrl"].includes(prefix) && sampleHtml && selector) {
    const urlSample = extractSampleUrlFromHtml(sampleHtml, selector, attribute);
    const result = await determineIsRelativeAndBaseUrl(urlSample, userIsRelative, userBaseUrl, body.feedUrl);
    isRelative = result.isRelative;
    baseUrl = result.baseUrl;
  }

  // Extract drill chain data directly if it was pre-processed into an array of objects
  const drillChainData = body[`${prefix}DrillChain`] as Array<any> || [];
  const target = new CSSTarget(
    selector,
    attribute,
    extractBoolField("StripHtml"),
    baseUrl,
    isRelative,
    extractBoolField("TitleCase"),
    extractField("Iterator"),
    extractField("Format")
  );
  if (prefix === "guid") {
    target.guidIsPermaLink = extractBoolField("IsPermaLink");
  }
  if (drillChainData.length > 0) {
    target.drillChain = drillChainData.map(step => ({
      selector: step.selector ?? "",
      attribute: step.attribute ?? "",
      isRelative: ["on", "true", true, "checked"].includes(String(step.isRelative).toLowerCase()),
      baseUrl: step.baseUrl ?? "",
      stripHtml: ["on", "true", true, "checked"].includes(String(step.stripHtml).toLowerCase()),
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
      isRelative: ["on", "true", true, "checked"].includes(String(step.isRelative).toLowerCase()),
      baseUrl: step.baseUrl ?? "",
      stripHtml: ["on", "true", true, "checked"].includes(String(step.stripHtml).toLowerCase()),
    }));
  }

  // This fallback logic for flat keys (e.g., titleDrillChain[0][selector]) 
  // should ideally not be needed if the main POST / handler correctly structures drill chains.
  // Keeping it as a safety measure or for cases where pre-structuring might fail.
  const chainSteps = [];
  const flatKeyRegex = new RegExp(`^${prefix.replace(/([A-Z])/g, ' $1').split(' ').map(s => s.toLowerCase()).join('')}DrillChain\[(\d+)\]\[(selector|attribute|isRelative|baseUrl|stripHtml)\]$`, 'i');
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

  const sortedKeys = Object.keys(tempStore).sort((a, b) => parseInt(a) - parseInt(b));
  for (const idx of sortedKeys) {
    const row = tempStore[idx];
    chainSteps.push({
      selector: row.selector ?? "",
      attribute: row.attribute ?? "",
      isRelative: ["on", "true", true, "checked"].includes(String(row.isrelative).toLowerCase()), // ensure lowercase for matching
      baseUrl: row.baseUrl ?? "",
      stripHtml: ["on", "true", true, "checked"].includes(String(row.striphtml).toLowerCase()), // ensure lowercase
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
    // The feedConfig passed here should now be the fully expanded one
    // including all item and feed level options as defined in POST / and /preview routes.

    if (feedConfig.feedType === "webScraping") {
      // feedConfig.config contains baseUrl, advanced settings
      // feedConfig.article contains all CSSTargets for items
      // feedConfig directly contains feed-level options like feedLanguage, feedCopyright, etc.
      // or selectors for these if they are to be scraped (though preview might use direct values).

      if (feedConfig.advanced) { // Check for advanced scraping (e.g., Playwright)
        const context = await chromium.launch({
          channel: "chrome",
          headless: true,
        });
        const page = await context.newPage();

        if (feedConfig.headers && Object.keys(feedConfig.headers).length) {
          await page.setExtraHTTPHeaders(feedConfig.headers);
        }

        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          const domain = new URL(feedConfig.config.baseUrl).hostname;
          const playwrightCookies = feedConfig.cookies.map(c => ({ ...c, domain, path: '/' }));
          if (playwrightCookies.length) await page.context().addCookies(playwrightCookies);
        }

        await page.goto(feedConfig.config.baseUrl, {
          waitUntil: "networkidle",
        });
        const html = await page.content();
        await context.close();
        // buildRSS expects the full feedConfig which now includes all detailed options
        rssXml = await buildRSS(html, feedConfig); 
      } else {
        // Standard axios call for non-advanced web scraping
        const cookieString = (feedConfig.cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
        const response = await axios.get(feedConfig.config.baseUrl, {
          headers: {
            ...(feedConfig.headers || {}),
            ...(cookieString && { Cookie: cookieString }),
          },
          maxContentLength: 2 * 1024 * 1024,
          maxBodyLength: 2 * 1024 * 1024,
        });
        const html = response.data;
        rssXml = await buildRSS(html, feedConfig);
      }
    } else if (feedConfig.feedType === "api") {
      // feedConfig.config contains API call details (baseUrl, route, method, params, apiSpecificHeaders, apiSpecificBody)
      // feedConfig.apiMapping contains paths to extract data from API response
      // feedConfig directly contains feed-level options (or paths to them in apiMapping)
      
      const axiosConfig: any = {
        method: feedConfig.config.method || "GET",
        url: feedConfig.config.baseUrl + (feedConfig.config.route || ""),
        headers: feedConfig.config.apiSpecificHeaders || feedConfig.headers || {},
        params: feedConfig.config.params || {},
        data: feedConfig.config.apiSpecificBody || {},
      };
      
      // If general cookies are present and no specific API auth is overriding, pass them.
      if (feedConfig.cookies && feedConfig.cookies.length > 0 && !axiosConfig.headers.Authorization && !axiosConfig.headers.cookie) {
        axiosConfig.headers.Cookie = feedConfig.cookies.map(c => `${c.name}=${c.value}`).join('; ');
      }

      console.log("Preview Axios Config:", axiosConfig);
      const response = await axios(axiosConfig);
      const apiData = response.data;

      // buildRSSFromApiData expects the full feedConfig which includes all detailed options and mappings
      rssXml = buildRSSFromApiData(apiData, feedConfig);
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
  port: 8000,
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
