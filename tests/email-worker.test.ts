import { describe, it, expect } from "bun:test";
import { Feed } from "feed";
import { buildRSSFromEmailFolder, extractEmailItems } from "../node/imap-watch.utility";
import type { Email } from "../node/imap-watch.utility";

const SAMPLE_CONFIG = {
  id: "http://localhost:5000/public/feeds/test-email.xml",
  title: "Test Email Feed",
  link: "mailto:test@example.com",
  description: "Test email feed",
  copyright: "",
  feedId: "test-email",
  feedName: "Test Email Feed",
  feedType: "email",
  config: { folder: "INBOX", emailCount: 10 },
};

const SAMPLE_EMAIL: Email = {
  UID: 1,
  messageId: "<test@example.com>",
  subject: "Test Subject",
  from: "sender@example.com",
  date: "2026-01-01T00:00:00.000Z",
  textBody: "Hello world",
};

describe("buildRSSFromEmailFolder", () => {
  it("returns a Feed instance (not a string)", () => {
    const result = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    expect(result.feed).toBeInstanceOf(Feed);
  });

  it("returns a commit function", () => {
    const result = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    expect(typeof result.commit).toBe("function");
  });

  it("Feed object produces valid RSS 2.0", () => {
    const { feed } = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    const rss = feed.rss2();
    expect(rss).toContain("<rss");
    expect(rss).toContain("Test Subject");
  });

  it("Feed object produces valid Atom", () => {
    const { feed } = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    expect(feed.atom1()).toContain("<feed");
  });
});

describe("extractEmailItems", () => {
  it("maps feed items to message shape with ISO date strings", () => {
    const { feed } = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    const items = extractEmailItems(feed);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("<test@example.com>");
    expect(typeof items[0].date).toBe("string");
    expect(() => new Date(items[0].date)).not.toThrow();
  });

  it("preserves description and content from email body", () => {
    const emailWithBody: Email = {
      ...SAMPLE_EMAIL,
      textBody: "Plain text body content",
      htmlBody: "<p>HTML body content</p>",
    };
    const { feed } = buildRSSFromEmailFolder([emailWithBody], SAMPLE_CONFIG as any);
    const items = extractEmailItems(feed);
    expect(items).toHaveLength(1);
    // description should be populated from the email body
    expect(items[0].description).toBeTruthy();
    expect(typeof items[0].description).toBe("string");
    // content should also be populated
    expect(items[0].content).toBeTruthy();
    expect(typeof items[0].content).toBe("string");
  });

  it("preserves author from email sender", () => {
    const { feed } = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    const items = extractEmailItems(feed);
    expect(items).toHaveLength(1);
    expect(Array.isArray(items[0].author)).toBe(true);
    expect(items[0].author![0].name).toBe("sender@example.com");
  });

  it("returns empty array for empty feed", () => {
    const { feed } = buildRSSFromEmailFolder([], SAMPLE_CONFIG as any);
    expect(extractEmailItems(feed)).toHaveLength(0);
  });
});
