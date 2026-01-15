import axios from "axios";
import dayjs from "dayjs";
import * as cheerio from "cheerio";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { Browser, chromium, Cookie, Page } from "patchright";
import { getChromiumLaunchOptions } from "./chrome-extensions.utility";
import { getRandomUserAgent } from "./user-agents.utility";
import { discoverUrl, looksLikeUrl } from "./rss-builder.utility";

dayjs.extend(customParseFormat);

export function stripHtml(html: string) {
  return html.replace(/<(?:.|\n)*?>/gm, "");
}

export function titleCase(words: string) {
  return words.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
  });
}

export function appendUrl(url?: string, link?: string) {
  if (!!url && !!link) {
    if (link.startsWith("/")) {
      return url.endsWith("/")
        ? `${url.substring(0, url.length - 1)}${link}`
        : `${url}${link}`;
    }
    return url.endsWith("/") ? `${url}${link}` : `${url}/${link}`;
  }
}

export function processWords(
  words?: string,
  title?: boolean,
  removeHtml?: boolean,
) {
  var result = words ?? "";
  if (removeHtml) result = stripHtml(result);
  if (title) result = titleCase(result);
  return result;
}

export function processLinks(
  words?: string,
  removeHtml?: boolean,
  relativeLink?: boolean,
  rootUrl?: string,
) {
  var result = words ?? "";
  if (removeHtml) result = stripHtml(result);
  if (relativeLink && rootUrl) result = appendUrl(rootUrl, result);
  return result;
}

export function processDates(
  date?: any,
  removeHtml?: boolean,
  userDateFormat?: string,
): Date {
  let result = date ?? "";
  if (removeHtml) result = stripHtml(result);

  // If already a Date object, return it
  if (result instanceof Date) {
    return result;
  }

  if (userDateFormat) {
    const parsed = dayjs(result, userDateFormat);
    if (parsed.isValid()) return parsed.toDate();
  }

  const patterns = [
    { regex: /\b\d{10}\b/, type: "unix" },
    { regex: /\b\d{13}\b/, type: "unixMillis" },
    {
      regex: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/,
      type: "iso",
    },
    { regex: /\b\d{4}-\d{2}-\d{2}\b/, type: "yyyy-mm-dd" },
    {
      regex: /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/,
      type: "yyyy-mm-dd hh:mm:ss",
    },
    {
      regex: /\b\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT\b/,
      type: "utc",
    },
  ];

  function parseDate(value: string, type: string): Date | null {
    switch (type) {
      case "unix":
        return new Date(parseInt(value) * 1000);
      case "unixMillis":
        return new Date(parseInt(value));
      case "iso":
        return new Date(value);
      case "yyyy-mm-dd":
        return new Date(`${value}T00:00:00Z`);
      case "yyyy-mm-dd hh:mm:ss":
        return new Date(value + "Z");
      case "utc":
        return new Date(value);
      default:
        return null;
    }
  }

  for (const { regex, type } of patterns) {
    const match = result.match(regex);
    if (match) {
      const parsedDate = parseDate(match[0], type);
      if (parsedDate && !isNaN(parsedDate.getTime())) {
        return parsedDate;
      }
    }
  }

  // Fallback: try to parse with Date constructor or return current date
  const fallbackDate = new Date(result);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }

  return new Date();
}

export function get(obj, path, defaultValue) {
  if (!path || typeof path !== "string") return defaultValue;
  const keys = path.split(".");
  let result = obj;
  for (let key of keys) {
    if (result == null || !(key in result)) return defaultValue;
    result = result[key];
  }
  return result;
}


export async function resolveDrillChain(
  startingHtmlOrUrl: string,
  chain: Array<{
    selector: string;
    attribute: string;
    isRelative: boolean;
    baseUrl: string;
    stripHtml: boolean;
  }>,
  useAdvanced: boolean = false,
  expectUrl: boolean = false,
  flaresolverr?: {
    enabled?: boolean;
    serverUrl?: string;
    timeout?: number;
  },
  cookies?: Array<{ name: string; value: string }>
): Promise<string> {
  if (!chain || chain.length === 0) return "";

  let currentHtml = "";
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    if (
      startingHtmlOrUrl.startsWith("http://") ||
      startingHtmlOrUrl.startsWith("https://")
    ) {
      if (flaresolverr?.enabled && flaresolverr?.serverUrl) {
        // Use FlareSolverr to fetch the initial URL
        const flaresolverrUrl = flaresolverr.serverUrl;
        const timeout = flaresolverr.timeout || 60000;

        const flaresolverrPayload: any = {
          cmd: "request.get",
          url: startingHtmlOrUrl,
          maxTimeout: timeout,
        };

        // Add cookies if present
        if (cookies && cookies.length > 0) {
          flaresolverrPayload.cookies = cookies.map((c) => ({
            name: c.name,
            value: c.value,
          }));
        }

        try {
          const flaresolverrResponse = await axios.post(
            `${flaresolverrUrl}/v1`,
            flaresolverrPayload,
            {
              headers: {
                "Content-Type": "application/json",
              },
              timeout: timeout + 5000,
            },
          );

          if (
            flaresolverrResponse.data?.solution?.response &&
            flaresolverrResponse.data?.solution?.status === 200
          ) {
            currentHtml = flaresolverrResponse.data.solution.response;
          } else {
            console.warn(
              "resolveDrillChain: FlareSolverr failed for",
              startingHtmlOrUrl,
              flaresolverrResponse.data?.message,
            );
            return "";
          }
        } catch (err) {
          console.warn(
            "resolveDrillChain: FlareSolverr error for",
            startingHtmlOrUrl,
            err.message,
          );
          return "";
        }
      } else if (useAdvanced) {
        browser = await chromium.launch(
          getChromiumLaunchOptions({
            headless: true,
            timeout: 60000, // 1 minute timeout
          }),
        );
        const userAgent = getRandomUserAgent();
        const context = await browser.newContext({ userAgent });
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
        });
        page = await context.newPage();
        try {
          await page.goto(startingHtmlOrUrl, {
            waitUntil: "networkidle",
            timeout: 10000, // 10 second timeout for networkidle
          });
        } catch {
          // If networkidle times out, page is likely already loaded
        }
        currentHtml = await page.content();
      } else {
        try {
          const resp = await axios.get(startingHtmlOrUrl, {
            maxContentLength: 2 * 1024 * 1024,
            maxBodyLength: 2 * 1024 * 1024,
          });
          currentHtml = resp.data;
        } catch (err) {
          console.warn(
            "resolveDrillChain: Skipped large or failed fetch for",
            startingHtmlOrUrl,
            err.message,
          );
          return "";
        }
      }
    } else {
      currentHtml = startingHtmlOrUrl;
    }

    let finalValue = "";

    console.log(`[DrillChain] Processing ${chain.length} step(s)`);
    for (let i = 0; i < chain.length; i++) {
      const { selector, attribute, isRelative, baseUrl } = chain[i];
      console.log(`[DrillChain] Step ${i + 1}: selector="${selector}", attribute="${attribute}"`);
      const $ = cheerio.load(currentHtml);
      const el = $(selector).first();
      if (!el || el.length === 0) {
        console.log(`[DrillChain] Step ${i + 1}: Selector not found, breaking`);
        finalValue = "";
        break;
      }
      console.log(`[DrillChain] Step ${i + 1}: Selector found`);

      const rawValue = attribute
        ? (el.attr(attribute) ?? "")
        : chain[i].stripHtml
          ? (el.text() ?? "")
          : (el.html() ?? "");

      if (i === chain.length - 1) {
        let val = rawValue;

        if (expectUrl && !looksLikeUrl(val)) {
          const $frag = cheerio.load(val); // rawValue might be HTML
          const mined = discoverUrl($frag, $frag.root());
          if (mined) val = mined;
        }

        finalValue = val;
      } else {
        let absoluteUrl = rawValue;
        if (isRelative && baseUrl) {
          absoluteUrl =
            baseUrl.endsWith("/") || rawValue.startsWith("/")
              ? baseUrl + rawValue
              : `${baseUrl}/${rawValue}`;
          console.log(`[DrillChain] Resolved relative URL: ${rawValue} -> ${absoluteUrl}`);
        }

        if (flaresolverr?.enabled && flaresolverr?.serverUrl) {
          // Use FlareSolverr for drill chain step
          const flaresolverrUrl = flaresolverr.serverUrl;
          const timeout = flaresolverr.timeout || 60000;

          const flaresolverrPayload: any = {
            cmd: "request.get",
            url: absoluteUrl,
            maxTimeout: timeout,
          };

          // Add cookies if present
          if (cookies && cookies.length > 0) {
            flaresolverrPayload.cookies = cookies.map((c) => ({
              name: c.name,
              value: c.value,
            }));
          }

          try {
            console.log(`[DrillChain] Using FlareSolverr for: ${absoluteUrl}`);
            const flaresolverrResponse = await axios.post(
              `${flaresolverrUrl}/v1`,
              flaresolverrPayload,
              {
                headers: {
                  "Content-Type": "application/json",
                },
                timeout: timeout + 5000,
              },
            );

            if (
              flaresolverrResponse.data?.solution?.response &&
              flaresolverrResponse.data?.solution?.status === 200
            ) {
              currentHtml = flaresolverrResponse.data.solution.response;
            } else {
              console.warn(
                "resolveDrillChain: FlareSolverr failed for step",
                absoluteUrl,
                flaresolverrResponse.data?.message,
              );
              finalValue = "";
              break;
            }
          } catch (err) {
            console.warn(
              "resolveDrillChain: FlareSolverr error for step",
              absoluteUrl,
              err.message,
            );
            finalValue = "";
            break;
          }
        } else if (useAdvanced && browser && page) {
          try {
            console.log(`[DrillChain] Navigating to: ${absoluteUrl}`);
            try {
              await page.goto(absoluteUrl, {
                waitUntil: "networkidle",
                timeout: 10000, // 10 second timeout for networkidle
              });
            } catch {
              // If networkidle times out, continue with current page state
            }
            currentHtml = await page.content();
          } catch {
            finalValue = "";
            break;
          }
        } else {
          try {
            const resp = await axios.get(absoluteUrl, {
              maxContentLength: 2 * 1024 * 1024,
              maxBodyLength: 2 * 1024 * 1024,
            });
            currentHtml = resp.data;
          } catch (err) {
            console.warn(
              "resolveDrillChain: Skipped large or failed fetch for",
              absoluteUrl,
              err.message,
            );
            finalValue = "";
            break;
          }
        }
      }
    }

    return finalValue;
  } finally {
    if (browser) await browser.close();
  }
}

export function parseCookiesForPlaywright(
  cookieString: string,
  domain: string,
): Cookie[] {
  return cookieString.split(";").map((part) => {
    const [name, ...valuePieces] = part.trim().split("=");
    return {
      name,
      value: valuePieces.join("="),
      domain, // or supply `url: feedConfig.config.baseUrl`
      path: "/",
    } as Cookie;
  });
}
