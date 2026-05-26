import { describe, it, expect } from "bun:test";
import {
  isLikelyAbsoluteUrl,
  determineIsRelativeAndBaseUrl,
  extractSampleUrlFromHtml,
  parseDrillChain,
} from "../utilities/css-target-builder.utility";

// ---------------------------------------------------------------------------
// isLikelyAbsoluteUrl
// ---------------------------------------------------------------------------

describe("isLikelyAbsoluteUrl", () => {
  it("returns true for https URLs", () => {
    expect(isLikelyAbsoluteUrl("https://example.com/path")).toBe(true);
  });

  it("returns true for http URLs", () => {
    expect(isLikelyAbsoluteUrl("http://example.com/path")).toBe(true);
  });

  it("returns true for protocol-relative URLs", () => {
    expect(isLikelyAbsoluteUrl("//example.com/path")).toBe(true);
  });

  it("returns false for root-relative paths", () => {
    expect(isLikelyAbsoluteUrl("/articles/1")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLikelyAbsoluteUrl("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineIsRelativeAndBaseUrl
// ---------------------------------------------------------------------------

describe("determineIsRelativeAndBaseUrl", () => {
  it("uses explicit userIsRelative and userBaseUrl when both provided", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "https://example.com/abs",
      true,
      "https://mysite.com",
      "https://feedurl.com",
    );
    expect(result.isRelative).toBe(true);
    expect(result.baseUrl).toBe("https://mysite.com");
  });

  it("falls back to feedUrl as baseUrl when userIsRelative=true but no userBaseUrl", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "/some/path",
      true,
      undefined,
      "https://feedurl.com",
    );
    expect(result.isRelative).toBe(true);
    expect(result.baseUrl).toBe("https://feedurl.com");
  });

  it("auto-detects absolute URL as not relative", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "https://example.com/abs",
      undefined,
      undefined,
      "https://feedurl.com",
    );
    expect(result.isRelative).toBe(false);
    expect(result.baseUrl).toBeUndefined();
  });

  it("auto-detects relative path and uses feedUrl as baseUrl", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "/articles/1",
      undefined,
      undefined,
      "https://feedurl.com",
    );
    expect(result.isRelative).toBe(true);
    expect(result.baseUrl).toBe("https://feedurl.com");
  });
});

// ---------------------------------------------------------------------------
// extractSampleUrlFromHtml
// ---------------------------------------------------------------------------

describe("extractSampleUrlFromHtml", () => {
  it("extracts href from matching elements", () => {
    const html = `<ul><li><a href="/article/1">Article 1</a></li></ul>`;
    const result = extractSampleUrlFromHtml(html, "a");
    expect(result).toBe("/article/1");
  });

  it("extracts custom attribute when specified", () => {
    const html = `<img data-src="https://cdn.example.com/img.jpg" />`;
    const result = extractSampleUrlFromHtml(html, "img", "data-src");
    expect(result).toBe("https://cdn.example.com/img.jpg");
  });

  it("returns empty string when selector matches nothing", () => {
    const html = `<div>No links here</div>`;
    const result = extractSampleUrlFromHtml(html, "a");
    expect(result).toBe("");
  });

  it("skips elements with empty URLs and returns first non-empty", () => {
    const html = `<a href="">empty</a><a href="/real">real</a>`;
    const result = extractSampleUrlFromHtml(html, "a");
    expect(result).toBe("/real");
  });
});

// ---------------------------------------------------------------------------
// parseDrillChain
// ---------------------------------------------------------------------------

describe("parseDrillChain", () => {
  it("returns empty array when no drill chain data", () => {
    const result = parseDrillChain("title", {});
    expect(result).toEqual([]);
  });

  it("parses array-form drill chain", () => {
    const body = {
      titleDrillChain: [
        { selector: ".inner", attribute: "href", isRelative: "true", baseUrl: "https://x.com", stripHtml: "false" },
      ],
    };
    const result = parseDrillChain("title", body);
    expect(result).toHaveLength(1);
    expect(result[0].selector).toBe(".inner");
    expect(result[0].isRelative).toBe(true);
    expect(result[0].stripHtml).toBe(false);
  });

  it("handles boolean values in drill chain steps", () => {
    const body = {
      titleDrillChain: [
        { selector: ".inner", attribute: "", isRelative: true, baseUrl: "", stripHtml: true },
      ],
    };
    const result = parseDrillChain("title", body);
    expect(result[0].isRelative).toBe(true);
    expect(result[0].stripHtml).toBe(true);
  });
});
