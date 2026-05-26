import { describe, it, expect } from "bun:test";
import { normalizeUrl, assembleFormBody } from "../utilities/feed-config-route-adapter.utility";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";

const KEY = "a18c1fd2211edd76a18c1fd2211edd76";

// ---------------------------------------------------------------------------
// normalizeUrl
// ---------------------------------------------------------------------------

describe("normalizeUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com///")).toBe("https://example.com");
  });

  it("leaves non-trailing slashes alone", () => {
    expect(normalizeUrl("https://example.com/path/to")).toBe(
      "https://example.com/path/to",
    );
  });

  it("handles empty string passthrough", () => {
    expect(normalizeUrl("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// assembleFormBody
// ---------------------------------------------------------------------------

describe("assembleFormBody", () => {
  it("assembles flat bracket-notation drill chain keys into arrays", () => {
    const raw = {
      feedType: "webScraping",
      "titleDrillChain[0][selector]": ".inner",
      "titleDrillChain[0][attribute]": "href",
      "titleDrillChain[0][isRelative]": "true",
    };
    const body = assembleFormBody(raw);
    expect(Array.isArray(body.titleDrillChain)).toBe(true);
    expect(body.titleDrillChain[0].selector).toBe(".inner");
    expect(body.titleDrillChain[0].isRelative).toBe("true");
  });

  it("does not disturb keys that are not drill chain keys", () => {
    const raw = { feedType: "webScraping", feedUrl: "https://x.com" };
    const body = assembleFormBody(raw);
    expect(body.feedType).toBe("webScraping");
    expect(body.feedUrl).toBe("https://x.com");
  });
});

// ---------------------------------------------------------------------------
// buildFeedConfigForRoute — via castFeedFormDataToFeedConfig integration
// ---------------------------------------------------------------------------

describe("buildFeedConfigForRoute (via caster integration)", () => {
  it("webScraping produces correct shape with feedGenerator via caster", () => {
    const data = {
      feedType: "webScraping",
      feedUrl: "https://example.com",
      feedName: "Test",
      refreshTime: 5,
      reverse: false,
      strict: false,
      advanced: false,
      headers: {},
      cookies: [],
      itemSelector: "li",
    };
    const config = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY });
    expect(config.feedType).toBe("webScraping");
    expect(config.schemaVersion).toBe(2);
  });

  it("api feedType uses rest internally via caster", () => {
    const data = {
      feedType: "api",
      feedUrl: "https://api.example.com",
      feedName: "API Feed",
      refreshTime: 5,
      reverse: false,
      strict: false,
      advanced: false,
      headers: {},
      cookies: [],
    };
    const config = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY });
    // caster normalises "api" -> "rest"
    expect(config.feedType).toBe("rest");
  });

  it("email config is shaped correctly via caster", () => {
    const data = {
      feedType: "email",
      feedName: "Email Feed",
      refreshTime: 5,
      reverse: false,
      strict: false,
      advanced: false,
      headers: {},
      cookies: [],
      emailHost: "imap.example.com",
      emailPort: "993",
      emailUsername: "user@example.com",
      emailPassword: "s3cr3t",
      emailFolder: "INBOX",
      emailCount: "10",
    };
    const config = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY });
    expect(config.feedType).toBe("email");
    // password should be encrypted (protected value object)
    expect((config as any).config.password).toBeDefined();
    expect((config as any).config.password.type).toBe("protected");
  });
});
