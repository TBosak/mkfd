import axios from "axios";
import dayjs from "dayjs";
import * as cheerio from "cheerio";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { Browser, chromium, Cookie, Page } from "patchright";
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
  const keys = path.split(".");
  let result = obj;
  for (let key of keys) {
    if (result == null || !(key in result)) {
      return defaultValue;
    }
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
  expectUrl: boolean = false
): Promise<string> {
  if (!chain || chain.length === 0) return "";

  let currentHtml = "";
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    if (startingHtmlOrUrl.startsWith("http://") || startingHtmlOrUrl.startsWith("https://")) {
      if (useAdvanced) {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        page = await context.newPage();
        await page.goto(startingHtmlOrUrl, { waitUntil: "networkidle" });
        currentHtml = await page.content();
      } else {
        try {
          const resp = await axios.get(startingHtmlOrUrl, {
            maxContentLength: 2 * 1024 * 1024,
            maxBodyLength: 2 * 1024 * 1024,
          });
          currentHtml = resp.data;
        } catch (err) {
          console.warn('resolveDrillChain: Skipped large or failed fetch for', startingHtmlOrUrl, err.message);
          return '';
        }
      }
    } else {
      currentHtml = startingHtmlOrUrl;
    }

    let finalValue = "";

    for (let i = 0; i < chain.length; i++) {
      const { selector, attribute, isRelative, baseUrl } = chain[i];
      const $ = cheerio.load(currentHtml);
      const el = $(selector).first();
      if (!el || el.length === 0) {
        finalValue = "";
        break;
      }

      const rawValue = attribute ? (el.attr(attribute) ?? "") : (chain[i].stripHtml ? (el.text() ?? "") : (el.html() ?? ""));

      if (i === chain.length - 1) {
        let val = rawValue;
      
        if (expectUrl && !looksLikeUrl(val)) {
          const $frag = cheerio.load(val);          // rawValue might be HTML
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
        }

        if (useAdvanced && browser && page) {
          try {
            await page.goto(absoluteUrl, { waitUntil: "networkidle" });
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
            console.warn('resolveDrillChain: Skipped large or failed fetch for', absoluteUrl, err.message);
            finalValue = '';
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

export function parseCookiesForPlaywright(cookieString: string, domain: string): Cookie[] {
  return cookieString.split(";").map(part => {
    const [name, ...valuePieces] = part.trim().split("=");
    return {
      name,
      value: valuePieces.join("="),
      domain,          // or supply `url: feedConfig.config.baseUrl`
      path: "/"
    } as Cookie;
  });
}