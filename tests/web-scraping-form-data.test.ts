import { describe, expect, test } from "bun:test";
import { detectForms, detectedFormToRequestConfig, scoreDetectedForm } from "../utilities/form-detection.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";

const html = `
  <form action="/search" method="GET">
    <label for="q">Search</label>
    <input id="q" type="search" name="q" required>
    <select name="sort"><option value="newest" selected>Newest</option></select>
    <button type="submit">Search</button>
  </form>
  <form action="/login" method="POST"><input type="password" name="password"></form>
`;

describe("web scraping form data", () => {
  test("detects and scores search forms first", () => {
    const forms = detectForms(html, "https://example.com/news");
    expect(forms[0]).toMatchObject({
      actionUrl: "https://example.com/search",
      method: "GET",
      confidenceBand: "high",
    });
    expect(scoreDetectedForm(forms[0])).toBeGreaterThan(scoreDetectedForm(forms[1]));
  });

  test("converts detected form to request config", () => {
    const request = detectedFormToRequestConfig(detectForms(html, "https://example.com/news")[0]);
    expect(request).toMatchObject({
      mode: "form",
      method: "GET",
      actionUrl: "https://example.com/search",
      fields: { q: "", sort: "newest" },
    });
  });

  test("validates unsupported form request values", () => {
    const result = validateFeedConfig({
      feedId: "form-feed",
      feedName: "Form Feed",
      feedType: "webScraping",
      refreshTime: 5,
      config: {
        baseUrl: "https://example.com/search",
        request: {
          mode: "form",
          method: "POST",
          encoding: "application/json",
          fields: { fileUpload: "x" },
        },
      },
      article: { iterator: { selector: ".item" } },
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === "config.request.fields")).toBe(true);
  });
});
