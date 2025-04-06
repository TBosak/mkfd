import axios from "axios";
import dayjs from "dayjs";
import * as cheerio from "cheerio";
import customParseFormat from "dayjs/plugin/customParseFormat";
import puppeteer, { Browser, Page } from "puppeteer";

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
) {
  let result = date ?? "";
  if (removeHtml) result = stripHtml(result);

  if (userDateFormat) {
    const parsed = dayjs(result, userDateFormat);
    if (parsed.isValid()) return parsed.toDate().toLocaleString();
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
        return parsedDate.toLocaleString();
      }
    }
  }

  return result;
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
  }>,
  useAdvanced: boolean = false
): Promise<string> {
  if (!chain || chain.length === 0) return "";

  let currentUrl = "";
  let currentHtml = "";
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    if (
      startingHtmlOrUrl.startsWith("http://") ||
      startingHtmlOrUrl.startsWith("https://")
    ) {
      if (useAdvanced) {
        browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        page = await browser.newPage();
        await page.goto(startingHtmlOrUrl, { waitUntil: "networkidle0" });
        currentHtml = await page.content();
        currentUrl = startingHtmlOrUrl;
      } else {
        const resp = await axios.get(startingHtmlOrUrl);
        currentHtml = resp.data;
        currentUrl = startingHtmlOrUrl;
      }
    } else {
      currentHtml = startingHtmlOrUrl;
    }

    let finalValue = "";

    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      const { selector, attribute, isRelative, baseUrl } = step;

      const $ = cheerio.load(currentHtml);
      const el = $(selector).first();
      if (!el || el.length === 0) {
        finalValue = "";
        break;
      }

      const rawValue = attribute ? el.attr(attribute) ?? "" : el.text() ?? "";

      if (i === chain.length - 1) {
        finalValue = rawValue;
      } else {
        let absoluteUrl = rawValue;
        if (isRelative && baseUrl) {
          if (!baseUrl.endsWith("/") && !rawValue.startsWith("/")) {
            absoluteUrl = baseUrl + "/" + rawValue;
          } else {
            absoluteUrl = baseUrl + rawValue;
          }
        }

        if (useAdvanced && browser && page) {
          try {
            await page.goto(absoluteUrl, { waitUntil: "networkidle0" });
            currentHtml = await page.content();
            currentUrl = absoluteUrl;
          } catch (err) {
            finalValue = "";
            break;
          }
        } else {
          try {
            const resp = await axios.get(absoluteUrl);
            currentHtml = resp.data;
            currentUrl = absoluteUrl;
          } catch (err) {
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