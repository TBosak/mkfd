/**
 * CSS Target Builder Utility
 *
 * Extracts CSS-target building logic: URL relativity detection,
 * sample URL extraction from HTML, drill chain parsing, and CSSTarget assembly.
 */

import * as cheerio from "cheerio";
import CSSTarget from "../models/csstarget.model";

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function isLikelyAbsoluteUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("//");
}

export async function determineIsRelativeAndBaseUrl(
  url: string,
  userIsRelative: boolean | undefined,
  userBaseUrl: string | undefined,
  feedUrl: string | undefined,
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
    // Relative URL — use feedUrl as base if available
    return { isRelative: true, baseUrl: feedUrl };
  }
}

// ---------------------------------------------------------------------------
// HTML sample extraction
// ---------------------------------------------------------------------------

export function extractSampleUrlFromHtml(
  html: string,
  selector: string,
  attribute?: string,
): string {
  const $ = cheerio.load(html);
  const elements = $(selector).slice(0, 5); // Check first 5 elements

  if (elements.length === 0) return "";

  for (let i = 0; i < elements.length; i++) {
    const el = elements.eq(i);
    let url = "";
    if (attribute) {
      url = el.attr(attribute) || "";
    } else {
      url = el.attr("href") || el.attr("src") || "";
    }

    if (url?.trim()) {
      return url.trim();
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Drill chain parsing
// ---------------------------------------------------------------------------

export type DrillChainStep = {
  selector: string;
  attribute: string;
  isRelative: boolean;
  baseUrl: string;
  stripHtml: boolean;
};

function parseBool(val: unknown): boolean {
  return ["on", "true", true, "checked"].includes(String(val).toLowerCase() as any);
}

export function parseDrillChain(
  prefix: string,
  body: Record<string, any>,
): DrillChainStep[] {
  const chainKey = `${prefix}DrillChain`;
  const rawChain = body[chainKey];

  if (Array.isArray(rawChain)) {
    return rawChain.map((step: any) => ({
      selector: step.selector ?? "",
      attribute: step.attribute ?? "",
      isRelative: parseBool(step.isRelative),
      baseUrl: step.baseUrl ?? "",
      stripHtml: parseBool(step.stripHtml),
    }));
  }

  // Flat-key fallback (e.g. titleDrillChain[0][selector])
  const chainSteps: DrillChainStep[] = [];
  const flatKeyRegex = new RegExp(
    `^${prefix
      .replace(/([A-Z])/g, " $1")
      .split(" ")
      .map((s) => s.toLowerCase())
      .join(
        "",
      )}DrillChain\\[(\\d+)\\]\\[(selector|attribute|isRelative|baseUrl|stripHtml)\\]$`,
    "i",
  );
  const tempStore: Record<string, Record<string, string>> = {};

  for (const key of Object.keys(body)) {
    const match = flatKeyRegex.exec(key);
    if (match) {
      const index = match[1];
      const fieldName = match[2];
      if (!tempStore[index]) tempStore[index] = {};
      tempStore[index][fieldName.toLowerCase()] = String(body[key]);
    }
  }

  const sortedKeys = Object.keys(tempStore).sort(
    (a, b) => parseInt(a, 10) - parseInt(b, 10),
  );
  for (const idx of sortedKeys) {
    const row = tempStore[idx];
    chainSteps.push({
      selector: row.selector ?? "",
      attribute: row.attribute ?? "",
      isRelative: parseBool(row.isrelative),
      baseUrl: row.baseUrl ?? "",
      stripHtml: parseBool(row.striphtml),
    });
  }
  return chainSteps;
}

// ---------------------------------------------------------------------------
// CSSTarget builder
// ---------------------------------------------------------------------------

export async function buildCSSTarget(
  prefix: string,
  body: Record<string, any>,
  sampleHtml?: string,
): Promise<CSSTarget> {
  const extractField = (suffix: string, fallback: any = "") =>
    body[`${prefix}${suffix}`] ?? fallback;
  const extractBoolField = (suffix: string, fallback: boolean = false): boolean => {
    const val = body[`${prefix}${suffix}`];
    if (val === undefined) return fallback;
    if (typeof val === "boolean") return val;
    return ["on", "true", "checked"].includes(String(val).toLowerCase());
  };

  const selector = extractField("Selector");
  const attribute = extractField("Attribute");
  const userIsRelative = extractBoolField("RelativeLink", undefined as any);
  const userBaseUrl = extractField("BaseUrl", undefined);

  let isRelative: boolean | undefined = userIsRelative;
  let baseUrl: string | undefined = userBaseUrl;

  // Only apply auto-detection to link, enclosure, sourceUrl fields
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
      body.feedUrl,
    );
    isRelative = result.isRelative;
    baseUrl = result.baseUrl;
    console.log(
      `[Preview ${prefix}] Sample URL: "${urlSample}" → isRelative: ${isRelative}, baseUrl: ${baseUrl}`,
    );
  }

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
    extractField("CustomDateFormat"),
  );

  if (prefix === "guid") {
    target.guidIsPermaLink = extractBoolField("IsPermaLink");
  }

  if (drillChainData.length > 0) {
    target.drillChain = drillChainData.map((step) => ({
      selector: step.selector ?? "",
      attribute: step.attribute ?? "",
      isRelative: parseBool(step.isRelative),
      baseUrl: step.baseUrl ?? "",
      stripHtml: parseBool(step.stripHtml),
    }));
  } else {
    target.drillChain = parseDrillChain(prefix, body);
  }

  return target;
}
